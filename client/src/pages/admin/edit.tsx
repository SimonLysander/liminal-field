/*
 * DraftEditPage — 沉浸式草稿编辑器 (/admin/notes/:id/edit)
 *
 * 布局：全屏沉浸式，无卡片浮起效果。顶栏单行：
 *   ← / 标题 | 工具栏(Portal) | 状态 + 操作按钮
 *
 * 内容区域：--layout-reading-max + shell padding，与阅读页一致。
 *
 * 右侧大纲面板：200px，从 markdown 提取标题层级，点击滚动到对应位置。
 *
 * 自动保存：1.5s debounce；⌘S 打开提交对话框，⇧⌘S 直接保存草稿。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useConfirm } from '@/contexts/ConfirmContext';
import { motion } from 'motion/react';
import { Sun, Moon } from 'lucide-react';
import { smoothBounce } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';
import { notesApi as contentItemsApi } from '@/services/workspace';
import type { ContentChangeType, ContentDetail, EditorDraft } from '@/services/workspace';
import { PlateMarkdownEditor } from './components/PlateEditor';
import { parseError } from './helpers';
import { LoadingState } from '@/components/LoadingState';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';
import { DraftAssetProvider } from '@/contexts/DraftAssetContext';
import { AiAdvisorPanel } from '@/components/ai-advisor/AiAdvisorPanel';
import { settingsApi } from '@/services/settings';

type EditorState = {
  title: string;
  summary: string;
  bodyMarkdown: string;
  changeNote: string;
  changeType: ContentChangeType;
};

type HeadingEntry = { level: number; text: string; index: number };

/** 模块级纯函数：避免 useMemo 内对闭包变量重新赋值触发 react-hooks 不可变/纯度规则 */
/** 清理标题中的 LaTeX 定界符：$$...$$ 移除，$...$ 保留内容 */
function stripLatexForToc(raw: string): string {
  return raw
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeadingEntriesFromMarkdown(bodyMarkdown: string): HeadingEntry[] {
  const acc: HeadingEntry[] = [];
  let idx = 0;
  let inCodeBlock = false;
  for (const line of bodyMarkdown.split('\n')) {
    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const text = stripLatexForToc(match[2].trim());
      if (!text) continue;
      acc.push({ level: match[1].length, text, index: idx });
      idx += 1;
    }
  }
  return acc;
}

const DraftEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();

  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [state, setState] = useState<EditorState>({
    title: '',
    summary: '',
    bodyMarkdown: '',
    changeNote: '更新内容',
    changeType: 'patch',
  });
  const [contentDetail, setContentDetail] = useState<ContentDetail | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [autosaveError, setAutosaveError] = useState('');
  const [resetKey] = useState(0);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  /* Portal 目标：Plate 工具栏通过 Portal 渲染到此元素内 */
  const [toolbarPortal, setToolbarPortal] = useState<HTMLDivElement | null>(null);

  /* Parse headings from markdown for outline — skips code blocks */
  const headings = useMemo<HeadingEntry[]>(
    () => extractHeadingEntriesFromMarkdown(state.bodyMarkdown),
    [state.bodyMarkdown],
  );

  const scrollToHeading = useCallback((index: number) => {
    const els = document.querySelectorAll(
      '[data-slate-editor] h1, [data-slate-editor] h2, [data-slate-editor] h3',
    );
    const el = els[index] as HTMLElement | undefined;
    if (!el) return;
    const container = document.querySelector('[data-scroll-container]') as HTMLElement | null;
    if (container) {
      const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 64;
      container.scrollTo({ top, behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError('');
      try {
        // 先请求草稿，有草稿直接用，跳过正式版请求
        let draft: EditorDraft | null = null;
        try {
          draft = await contentItemsApi.getDraft(id);
        } catch (err) {
          // 草稿不存在或请求失败均视为无草稿，继续加载正式版本
          console.error('[DraftEditPage] 获取草稿失败, 视为无草稿:', err);
        }

        if (cancelled) return;

        if (draft) {
          // 有草稿：直接恢复，不请求正式版（避免多余请求）
          setState({
            title: draft.title,
            summary: draft.summary,
            bodyMarkdown: draft.bodyMarkdown,
            changeNote: draft.changeNote,
            changeType: 'patch',
          });
          setLastSavedAt(draft.savedAt);
        } else {
          // 无草稿：请求正式版，并创建初始草稿供自动保存使用
          const detail = await contentItemsApi.getById(id, { visibility: 'all' });
          if (cancelled) return;
          setContentDetail(detail);
          const newDraft = await contentItemsApi.saveDraft(id, {
            title: detail.latestVersion.title,
            summary: detail.latestVersion.summary,
            bodyMarkdown: detail.bodyMarkdown,
            changeNote: '更新内容',
          });
          if (cancelled) return;
          setState({
            title: newDraft.title,
            summary: newDraft.summary,
            bodyMarkdown: newDraft.bodyMarkdown,
            changeNote: newDraft.changeNote,
            changeType: 'patch',
          });
          setLastSavedAt(newDraft.savedAt);
        }
      } catch (initError) {
        if (!cancelled) setError(parseError(initError, '加载内容失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleChange = useCallback(
    <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
      setIsDirty(true);
      setAutosaveError('');
    },
    [],
  );

  const saveDraft = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!id) return;

      if (options?.silent) {
        setIsAutosaving(true);
        setAutosaveError('');
      }

      try {
        const draft = await contentItemsApi.saveDraft(id, {
          title: state.title,
          summary: state.summary,
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
        setIsDirty(false);
        setLastSavedAt(draft.savedAt);
        setIsAutosaving(false);

        // 手动保存成功（inline SaveStatus 已提供视觉反馈，无需弹窗）
      } catch (saveError) {
        setIsAutosaving(false);
        if (options?.silent) {
          setAutosaveError(parseError(saveError, '自动保存失败'));
        } else {
          setError(parseError(saveError, '保存失败'));
        }
      }
    },
    [id, state],
  );

  /* AI 顾问面板状态 */
  /* 按 writing-advisor 入口配置的 enabled 字段控制面板是否渲染 */
  const [agentEnabled, setAgentEnabled] = useState(true);

  useEffect(() => {
    // 加载 agent 入口配置，按 enabled 决定是否渲染 AI 顾问面板
    settingsApi.getAgentConfigs().then((configs) => {
      const writingAdvisor = configs.find((c) => c.key === 'writing-advisor');
      // 配置不存在时保守降级为 false（不渲染），避免无配置时的歧义行为
      setAgentEnabled(writingAdvisor?.enabled ?? false);
    }).catch(() => {
      // 请求失败时保持 true，确保正常使用时不受影响
    });
  }, []);

  /* 编辑器内当前选中文本（暂未接入 Plate 选区监听，预留入口） */
  const [selectedText] = useState<string | undefined>(undefined);

  const [committing, setCommitting] = useState(false);
  const navigateTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(navigateTimerRef.current); }, []);

  const commitDraft = useCallback(async () => {
    if (!id) return;
    setCommitting(true);
    setShowCommitDialog(false);

    try {
      const saved = await contentItemsApi.save(id, {
        title: state.title,
        summary: state.summary,
        status: 'committed',
        bodyMarkdown: state.bodyMarkdown,
        changeNote: state.changeNote,
        changeType: state.changeType,
        action: 'commit',
      });

      await contentItemsApi.deleteDraft(id);
      setContentDetail(saved);
      setIsDirty(false);
      setLastSavedAt('');

      // 提交成功后立即跳转（页面跳转本身就是成功反馈）
      navigateTimerRef.current = window.setTimeout(() => navigate(-1), 800);
    } catch (commitError) {
      setCommitting(false);
      setError(parseError(commitError, '提交失败'));
    }
  }, [id, state, navigate]);

  const discardDraft = useCallback(async () => {
    if (!id) return;
    const ok = await confirm({ title: '丢弃草稿', message: '确认丢弃当前草稿？', danger: true, confirmLabel: '丢弃' });
    if (!ok) return;

    try {
      await contentItemsApi.deleteDraft(id);
      navigate(-1);
    } catch (discardError) {
      setError(parseError(discardError, '丢弃失败'));
    }
  }, [id, navigate, confirm]);

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      if (e.shiftKey) void saveDraft();
      else setShowCommitDialog(true);
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [saveDraft]);

  useEffect(() => {
    if (!isDirty || loading) return;
    const timer = window.setTimeout(() => void saveDraft({ silent: true }), 1500);
    return () => window.clearTimeout(timer);
  }, [isDirty, loading, saveDraft]);

  if (loading) {
    return <LoadingState variant="full" />;
  }

  if (error && !contentDetail) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3" style={{ background: 'var(--paper)' }}>
        <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-base)' }}>{error}</p>
        <button style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }} onClick={() => navigate(-1)}>
          返回管理后台
        </button>
      </div>
    );
  }

  /*
   * CSS Grid 三栏布局：
   *   列：AI 面板 | 编辑器 | 大纲
   *   行：顶栏(48px) | 内容(1fr)
   * 顶栏各单元格自然对齐到下方的列，工具栏不会溢出到 AI 面板。
   */
  const gridColumns = 'clamp(18rem, 22vw, 22rem) 1fr var(--layout-sidebar)';

  return (
    <div
      className="grid h-screen overflow-hidden"
      style={{
        background: 'var(--paper)',
        gridTemplateColumns: gridColumns,
        gridTemplateRows: '48px 1fr',
      }}
    >
      <ThresholdOverlay visible={committing} label="正在提交版本..." />

      {/* ── Row 1: 顶栏，分成三个 grid cell ── */}

      {/* [1,1] AI 面板上方：返回 + 标题 */}
      <div className="flex items-center px-3">
        <div
          className="flex min-w-0 items-center gap-2"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            border: '1px solid var(--glass-border)',
            borderRadius: 20,
            padding: '4px 12px',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <button
            className="hover-shelf shrink-0 rounded-md px-2 py-1 transition-colors duration-150"
            style={{ color: 'var(--ink-faded)' }}
            onClick={() => navigate(-1)}
          >
            ←
          </button>
          <span style={{ color: 'var(--ink-ghost)' }}>/</span>
          <input
            type="text"
            value={state.title}
            onChange={(e) => handleChange('title', e.target.value)}
            placeholder="无标题"
            className="w-[120px] shrink-0 truncate border-none bg-transparent text-sm font-medium outline-none placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)' }}
          />
        </div>
      </div>

      {/* [1,2-3] 工具栏居中 + 右胶囊靠右 */}
      <div
        className="flex min-w-0 items-center px-4"
        style={{ gridColumn: '2 / -1' }}
      >
        {/* 工具栏：flex-1 吃满空间，内容居中，超出滚动 */}
        <div
          ref={setToolbarPortal}
          className="flex min-w-0 flex-1 items-center justify-center overflow-x-auto"
        />

        {/* 右侧胶囊 */}
        <div
          className="ml-4 flex shrink-0 items-center gap-3"
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(12px) saturate(180%)',
            WebkitBackdropFilter: 'blur(12px) saturate(180%)',
            border: '1px solid var(--glass-border)',
            borderRadius: 20,
            padding: '4px 12px',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {isAutosaving && <StatusDot color="var(--mark-blue)" />}
            {isDirty && !isAutosaving && <StatusDot color="var(--mark-red)" />}
            {!isDirty && !isAutosaving && lastSavedAt && <StatusDot color="var(--mark-green)" />}
            {lastSavedAt && (
              <span>{new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
            )}
            {autosaveError && <span style={{ color: 'var(--mark-red)' }}>{autosaveError}</span>}
          </div>
          <button
            className="hover-shelf flex h-7 w-7 items-center justify-center rounded-lg transition-colors duration-200"
            style={{ color: 'var(--ink-faded)' }}
            onClick={() => setTheme(theme === 'daylight' ? 'midnight' : 'daylight')}
            aria-label="切换主题"
          >
            <Sun size={14} strokeWidth={1.5} className="theme-icon-light" />
            <Moon size={14} strokeWidth={1.5} className="theme-icon-dark" />
          </button>
          <div className="flex items-center gap-1">
            <ActionPill label="保存" shortcut="⇧⌘S" onClick={() => void saveDraft()} />
            <ActionPill label="提交" shortcut="⌘S" primary onClick={() => setShowCommitDialog(true)} />
            <ActionPill label="丢弃" danger onClick={() => void discardDraft()} />
          </div>
        </div>
      </div>

      {/* ── Row 2: 内容区 ── */}

      {/* [2,1] AI 面板：按 AgentEntryConfig.enabled 控制是否渲染 */}
      {agentEnabled ? (
        <AiAdvisorPanel
          sessionKey={`draft-${id}`}
          contentItemId={id}
          title={state.title}
          bodyMarkdown={state.bodyMarkdown}
          selectedText={selectedText}
        />
      ) : (
        // 未启用时渲染空 div 占位，保持三栏 grid 结构不变
        <div />
      )}

      {/* [2,2] 编辑器 */}
      <div className="min-w-0 overflow-y-auto overflow-x-hidden" data-scroll-container>
        {error && contentDetail && (
          <div className="px-6 py-2" style={{ background: 'rgba(255,59,48,0.06)' }}>
            <p className="text-sm" style={{ color: 'var(--mark-red)' }}>{error}</p>
          </div>
        )}
        <div className="mx-auto w-full max-w-[var(--layout-editor-max)] pb-40 pt-10">
          <DraftAssetProvider contentItemId={id!}>
            <PlateMarkdownEditor
              key={`${id}-${resetKey}`}
              initialMarkdown={state.bodyMarkdown}
              onChange={(md) => handleChange('bodyMarkdown', md)}
              toolbarContainer={toolbarPortal}
            />
          </DraftAssetProvider>
        </div>
      </div>

      {/* [2,3] 大纲 */}
      <div className="overflow-y-auto px-4 py-10">
        <div
          className="mb-3 font-semibold uppercase"
          style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)', letterSpacing: '0.04em' }}
        >
          大纲
        </div>
        <nav>
          {headings.length === 0 ? (
            <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-ghost)' }}>
              使用标题构建文档结构
            </p>
          ) : (
            headings.map((h) => (
              <button
                key={`${h.index}-${h.text}`}
                className="outline-heading-btn w-full truncate rounded-md py-1.5 text-left text-sm transition-colors duration-100"
                style={{
                  paddingLeft: `${(h.level - 1) * 8 + 10}px`,
                  paddingRight: 8,
                  color: 'var(--ink-faded)',
                  fontWeight: 400,
                }}
                onClick={() => scrollToHeading(h.index)}
              >
                {h.text}
              </button>
            ))
          )}
        </nav>
      </div>

      {/* Commit dialog */}
      {showCommitDialog && (
        <CommitDialog
          changeNote={state.changeNote}
          onChangeNote={(v) => handleChange('changeNote', v)}
          onConfirm={() => void commitDraft()}
          onCancel={() => setShowCommitDialog(false)}
        />
      )}
    </div>
  );
};

/* ---------- Commit Dialog ---------- */

function CommitDialog({
  changeNote,
  onChangeNote,
  onConfirm,
  onCancel,
}: {
  changeNote: string;
  onChangeNote: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
      onClick={onCancel}
    >
      <motion.div
        className="w-full max-w-[400px] rounded-2xl p-6"
        style={{
          background: 'var(--paper-light)',
          border: '1px solid var(--box-border)',
          boxShadow: 'var(--shadow-lg)',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25, ease: smoothBounce }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold" style={{ color: 'var(--ink)', fontSize: 'var(--text-md)', letterSpacing: '-0.01em' }}>
          提交版本
        </h3>
        <p className="mb-5" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-base)' }}>
          将当前草稿提交为正式版本
        </p>

        <div className="space-y-3.5">

          <label className="flex flex-col gap-1.5">
            <span className="font-medium" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }}>变更说明</span>
            <input
              type="text"
              value={changeNote}
              onChange={(e) => onChangeNote(e.target.value)}
              autoFocus
              className="rounded-lg border-none px-3 py-2 outline-none"
              style={{ background: 'var(--shelf)', color: 'var(--ink)', fontSize: 'var(--text-base)' }}
            />
          </label>

        </div>

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            className="rounded-lg px-3.5 py-1.5 transition-colors duration-150"
            style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }}
            onClick={onCancel}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--shelf)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            取消
          </button>
          <button
            className="rounded-lg px-4 py-1.5 font-medium transition-all duration-150"
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 'var(--text-base)' }}
            onClick={onConfirm}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            确认提交
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ---------- Primitives ---------- */

function StatusDot({ color }: { color: string }) {
  return (
    <span
      className="h-[6px] w-[6px] rounded-full"
      style={{ background: color, boxShadow: `0 0 6px ${color}40` }}
    />
  );
}

function ActionPill({
  label,
  shortcut,
  primary,
  danger,
  onClick,
}: {
  label: string;
  shortcut?: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-md px-2.5 py-1 transition-all duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontSize: 'var(--text-base)',
        fontWeight: primary ? 600 : 400,
      }}
      onClick={onClick}
      onMouseEnter={(e) => { if (!danger) e.currentTarget.style.background = 'var(--shelf)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      title={shortcut}
    >
      {label}
    </button>
  );
}

export default DraftEditPage;
