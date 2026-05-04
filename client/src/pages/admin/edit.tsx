/*
 * DraftEditPage — 沉浸式草稿编辑器 (/admin/notes/:id/edit)
 *
 * 布局：全屏沉浸式，无卡片浮起效果。顶栏单行：
 *   ← / 标题 | 工具栏(Portal) | 状态 + 操作按钮
 *
 * 内容区域：max-w-[740px] px-10，与阅读页宽度一致（所见即所得）。
 *
 * 右侧大纲面板：200px，从 markdown 提取标题层级，点击滚动到对应位置。
 *
 * 自动保存：1.5s debounce；⌘S 打开提交对话框，⇧⌘S 直接保存草稿。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Sun, Moon } from 'lucide-react';
import { toast } from 'sonner';
import { smoothBounce } from '@/lib/motion';
import { useTheme } from '@/hooks/use-theme';
import { notesApi as contentItemsApi } from '@/services/workspace';
import type { ContentChangeType, ContentDetail, EditorDraft } from '@/services/workspace';
import { PlateMarkdownEditor } from './components/PlateEditor';
import { parseError } from './helpers';
import { LoadingState } from '@/components/LoadingState';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';
import { DraftAssetProvider } from '@/contexts/DraftAssetContext';

type EditorState = {
  title: string;
  summary: string;
  bodyMarkdown: string;
  changeNote: string;
  changeType: ContentChangeType;
};

type HeadingEntry = { level: number; text: string; index: number };

const DraftEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
  const headings = useMemo<HeadingEntry[]>(() => {
    let idx = 0;
    let inCodeBlock = false;
    return state.bodyMarkdown
      .split('\n')
      .reduce<HeadingEntry[]>((acc, line) => {
        if (line.startsWith('```')) {
          inCodeBlock = !inCodeBlock;
          return acc;
        }
        if (inCodeBlock) return acc;
        const match = line.match(/^(#{1,3})\s+(.+)$/);
        if (match) {
          acc.push({ level: match[1].length, text: match[2].trim(), index: idx });
          idx++;
        }
        return acc;
      }, []);
  }, [state.bodyMarkdown]);

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

    const init = async () => {
      setLoading(true);
      setError('');
      try {
        let draft: EditorDraft | null = null;
        try {
          draft = await contentItemsApi.getDraft(id);
        } catch { /* No draft */ }

        const detail = await contentItemsApi.getById(id, { visibility: 'all' });
        setContentDetail(detail);

        if (draft) {
          setState({
            title: draft.title,
            summary: draft.summary,
            bodyMarkdown: draft.bodyMarkdown,
            changeNote: draft.changeNote,
            changeType: 'patch',
          });
          setLastSavedAt(draft.savedAt);
        } else {
          const newDraft = await contentItemsApi.saveDraft(id, {
            title: detail.latestVersion.title,
            summary: detail.latestVersion.summary,
            bodyMarkdown: detail.bodyMarkdown,
            changeNote: '更新内容',
          });
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
        setError(parseError(initError, '加载内容失败'));
      } finally {
        setLoading(false);
      }
    };

    void init();
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

        if (!options?.silent) {
          toast.success('草稿已保存');
        }
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
      toast.success('已提交正式版本');

      navigateTimerRef.current = window.setTimeout(() => navigate(-1), 800);
    } catch (commitError) {
      setCommitting(false);
      setError(parseError(commitError, '提交失败'));
    }
  }, [id, state, navigate]);

  const discardDraft = useCallback(async () => {
    if (!id) return;
    const confirmed = window.confirm('确认丢弃当前草稿？');
    if (!confirmed) return;

    try {
      await contentItemsApi.deleteDraft(id);
      navigate(-1);
    } catch (discardError) {
      setError(parseError(discardError, '丢弃失败'));
    }
  }, [id, navigate]);

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

  return (
    <div className="flex h-screen" style={{ background: 'var(--paper)' }}>
      <ThresholdOverlay visible={committing} label="正在提交版本..." />

      <main className="relative z-0 flex flex-1 flex-col overflow-hidden">
        {/* 顶栏：两组浮动胶囊 + 中间 Portal 工具栏，无全宽底边线 */}
        <header
          className="flex shrink-0 items-center gap-3"
          style={{ height: 48, padding: '8px 16px' }}
        >
          {/* 左侧胶囊：返回导航 + 标题输入 */}
          <div
            className="flex shrink-0 items-center gap-2"
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
              style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }}
              onClick={() => navigate(-1)}
            >
              ←
            </button>
            <span className="shrink-0" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-base)' }}>/</span>
            <input
              type="text"
              value={state.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="无标题"
              className="w-[160px] shrink-0 truncate border-none bg-transparent font-medium outline-none placeholder:text-[var(--ink-ghost)]"
              style={{ color: 'var(--ink)', fontSize: 'var(--text-base)' }}
            />
          </div>

          {/* 工具栏占据中间空间（Portal 注入），不包在胶囊里 */}
          <div ref={setToolbarPortal} className="min-w-0 flex-1 overflow-x-auto" />

          {/* 右侧胶囊：状态指示 + 主题切换 + 操作按钮 */}
          <div
            className="flex shrink-0 items-center gap-3"
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
            <div className="flex items-center gap-2" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}>
              {isAutosaving && <StatusDot color="var(--mark-blue)" />}
              {isDirty && !isAutosaving && <StatusDot color="var(--mark-red)" />}
              {!isDirty && !isAutosaving && lastSavedAt && <StatusDot color="var(--mark-green)" />}
              {lastSavedAt && (
                <span>{new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              )}
              {autosaveError && <span style={{ color: 'var(--mark-red)' }}>{autosaveError}</span>}
            </div>
            <button
              className="hover-shelf flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-200"
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
        </header>

        {error && contentDetail && (
          <div className="px-6 py-2" style={{ background: 'rgba(255,59,48,0.06)' }}>
            <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-base)' }}>{error}</p>
          </div>
        )}

        {/* Body — editor + right outline */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-hidden" data-scroll-container>
            <div className="mx-auto w-[85%] min-w-[600px] max-w-[960px] pb-40 pt-10">
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

          {/* Right — outline */}
          <div
            className="flex w-[200px] shrink-0 flex-col overflow-y-auto px-4 py-10"
            style={{}}
          >
            <div
              className="mb-3 font-semibold uppercase"
              style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)', letterSpacing: '0.04em' }}
            >
              大纲
            </div>
            <nav className="flex-1">
              {headings.length === 0 ? (
                <p className="py-6 text-center" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}>
                  使用标题构建文档结构
                </p>
              ) : (
                headings.map((h) => (
                  <button
                    key={`${h.index}-${h.text}`}
                    className="outline-heading-btn w-full truncate rounded-md py-1.5 text-left transition-colors duration-100"
                    style={{
                      paddingLeft: `${(h.level - 1) * 8 + 10}px`,
                      paddingRight: 8,
                      color: 'var(--ink-faded)',
                      fontSize: 'var(--text-sm)',
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
        </div>
      </main>

      {/* Commit dialog */}
      {showCommitDialog && (
        <CommitDialog
          summary={state.summary}
          changeNote={state.changeNote}
          changeType={state.changeType}
          onSummary={(v) => handleChange('summary', v)}
          onChangeNote={(v) => handleChange('changeNote', v)}
          onChangeType={(v) => handleChange('changeType', v)}
          onConfirm={() => void commitDraft()}
          onCancel={() => setShowCommitDialog(false)}
        />
      )}
    </div>
  );
};

/* ---------- Commit Dialog ---------- */

function CommitDialog({
  summary,
  changeNote,
  changeType,
  onSummary,
  onChangeNote,
  onChangeType,
  onConfirm,
  onCancel,
}: {
  summary: string;
  changeNote: string;
  changeType: ContentChangeType;
  onSummary: (v: string) => void;
  onChangeNote: (v: string) => void;
  onChangeType: (v: ContentChangeType) => void;
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
            <span className="font-medium" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }}>摘要</span>
            <textarea
              value={summary}
              onChange={(e) => onSummary(e.target.value)}
              placeholder="简要描述文档内容..."
              className="min-h-[60px] resize-y rounded-lg border-none px-3 py-2 outline-none"
              style={{ background: 'var(--shelf)', color: 'var(--ink)', fontSize: 'var(--text-base)' }}
            />
          </label>

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

          <label className="flex flex-col gap-1.5">
            <span className="font-medium" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-base)' }}>变更类型</span>
            <select
              value={changeType}
              onChange={(e) => onChangeType(e.target.value as ContentChangeType)}
              className="rounded-lg border-none px-3 py-2 outline-none"
              style={{ background: 'var(--shelf)', color: 'var(--ink)', fontSize: 'var(--text-base)' }}
            >
              <option value="patch">patch — 小幅修改</option>
              <option value="major">major — 重大更新</option>
            </select>
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
