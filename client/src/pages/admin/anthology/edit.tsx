/*
 * AnthologyEntryEditPage — 文集条目草稿编辑器
 * 路由：/admin/anthology/:id/entries/:entryKey/edit
 *
 * 心智模型与 DraftEditPage（Notes 编辑器）完全一致：
 * - 打开编辑器 → 加载草稿（有草稿恢复草稿，无草稿从正式版本创建初始草稿）
 * - 编辑时 1.5s debounce autosave 草稿
 * - ⌘S 打开提交对话框 → 确认提交（saveEntry → 后端自动删草稿）
 * - ⇧⌘S 手动保存草稿
 * - 顶栏状态指示（保存中/已保存/未保存）+ 右侧大纲面板
 *
 * 与 DraftEditPage 的差异：
 * - URL 参数：id（anthologyId）+ entryKey
 * - 无 summary / changeType 字段
 * - 加载/保存接口均走 anthologyApi 的条目草稿方法
 * - date 不在编辑器里（在条目列表或新建弹窗里设置）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useConfirm } from '@/contexts/ConfirmContext';
import { Sun, Moon } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { anthologyApi } from '@/services/workspace';
import type { EditorDraft } from '@/services/workspace';
import { PlateMarkdownEditor } from '../components/PlateEditor';
import { parseError } from '../helpers';
import { type HeadingEntry, extractHeadingEntriesFromMarkdown } from '../lib/markdown-toc';
import { EditorOutline } from '../components/EditorOutline';
import { LoadingState } from '@/components/LoadingState';
import { ThresholdOverlay } from '@/components/shared/ThresholdOverlay';
import { DraftAssetProvider } from '@/contexts/DraftAssetContext';

// ─── 类型 ─────────────────────────────────────────────────────────────────────

type EditorState = {
  title: string;
  bodyMarkdown: string;
  changeNote: string;
};

// ─── 主页面 ─────────────────────────────────────────────────────────────────

const AnthologyEntryEditPage = () => {
  const { id, entryKey } = useParams<{ id: string; entryKey: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();

  /**
   * 安全返回:有 app 内上一页就回退,否则去文集管理后台。
   * 修复"有时候点返回页面出错"(直接打开/刷新过编辑页时 navigate(-1) 退到 app 外/坏页)。
   */
  const goBack = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/admin/anthology');
  }, [location.key, navigate]);

  const { theme, setTheme } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [state, setState] = useState<EditorState>({
    title: '',
    bodyMarkdown: '',
    changeNote: '更新条目',
  });
  const [isDirty, setIsDirty] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [autosaveError, setAutosaveError] = useState('');
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [committing, setCommitting] = useState(false);

  /* Portal 目标：Plate 工具栏通过 Portal 渲染到此元素内 */
  const [toolbarPortal, setToolbarPortal] = useState<HTMLDivElement | null>(null);

  /* 大纲：从 markdown 提取标题层级 */
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
      const top =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        64;
      container.scrollTo({ top, behavior: 'smooth' });
    }
  }, []);

  // ─── 初始化：加载草稿，无草稿则从正式版创建 ──────────────────────────────

  useEffect(() => {
    if (!id || !entryKey) return;
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
          draft = await anthologyApi.getEntryDraft(id, entryKey);
        } catch (err) {
          console.error('[AnthologyEntryEditPage] 获取草稿失败, 视为无草稿:', err);
          // 草稿不存在或请求失败均视为无草稿，继续加载正式版
        }

        if (cancelled) return;

        if (draft) {
          // 有草稿：直接恢复
          setState({
            title: draft.title,
            bodyMarkdown: draft.bodyMarkdown,
            changeNote: draft.changeNote,
          });
          setLastSavedAt(draft.savedAt);
        } else {
          // 无草稿：从正式版本读取，创建初始草稿
          const entry = await anthologyApi.getEntry(id, entryKey);
          if (cancelled) return;
          const newDraft = await anthologyApi.saveEntryDraft(id, entryKey, {
            title: entry.title,
            summary: '',
            bodyMarkdown: entry.bodyMarkdown,
            changeNote: '更新条目',
          });
          if (cancelled) return;
          setState({
            title: newDraft.title,
            bodyMarkdown: newDraft.bodyMarkdown,
            changeNote: newDraft.changeNote,
          });
          setLastSavedAt(newDraft.savedAt);
        }
      } catch (initError) {
        if (!cancelled) setError(parseError(initError, '加载条目失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, entryKey]);

  // ─── 变更处理 ─────────────────────────────────────────────────────────────

  const handleChange = useCallback(
    <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
      setIsDirty(true);
      setAutosaveError('');
    },
    [],
  );

  // ─── 草稿保存 ─────────────────────────────────────────────────────────────

  const saveDraft = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!id || !entryKey) return;

      if (options?.silent) {
        setIsAutosaving(true);
        setAutosaveError('');
      }

      try {
        const draft = await anthologyApi.saveEntryDraft(id, entryKey, {
          title: state.title,
          summary: '',
          bodyMarkdown: state.bodyMarkdown,
          changeNote: state.changeNote,
        });
        setIsDirty(false);
        setLastSavedAt(draft.savedAt);
        setIsAutosaving(false);
      } catch (saveError) {
        setIsAutosaving(false);
        if (options?.silent) {
          setAutosaveError(parseError(saveError, '自动保存失败'));
        } else {
          setError(parseError(saveError, '保存失败'));
        }
      }
    },
    [id, entryKey, state],
  );

  // ─── 提交 ─────────────────────────────────────────────────────────────────

  const navigateTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(navigateTimerRef.current); }, []);

  const commitDraft = useCallback(async () => {
    if (!id || !entryKey) return;
    setCommitting(true);
    setShowCommitDialog(false);

    try {
      // saveEntry 后端会自动删除该条目的草稿
      await anthologyApi.saveEntry(id, entryKey, {
        title: state.title,
        bodyMarkdown: state.bodyMarkdown,
        changeNote: state.changeNote,
      });
      setIsDirty(false);
      setLastSavedAt('');

      // 提交成功后跳转回管理页
      navigateTimerRef.current = window.setTimeout(() => goBack(), 800);
    } catch (commitError) {
      setCommitting(false);
      setError(parseError(commitError, '提交失败'));
    }
  }, [id, entryKey, state, goBack]);

  // ─── 丢弃草稿 ─────────────────────────────────────────────────────────────

  const discardDraft = useCallback(async () => {
    if (!id || !entryKey) return;
    const ok = await confirm({
      title: '丢弃草稿',
      message: '确认丢弃当前草稿？',
      danger: true,
      confirmLabel: '丢弃',
    });
    if (!ok) return;

    try {
      await anthologyApi.deleteEntryDraft(id, entryKey);
      goBack();
    } catch (discardError) {
      setError(parseError(discardError, '丢弃失败'));
    }
  }, [id, entryKey, goBack, confirm]);

  // ─── 快捷键 ──────────────────────────────────────────────────────────────

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

  // ─── 1.5s autosave ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!isDirty || loading) return;
    const timer = window.setTimeout(() => void saveDraft({ silent: true }), 1500);
    return () => window.clearTimeout(timer);
  }, [isDirty, loading, saveDraft]);

  // ─── 渲染 ─────────────────────────────────────────────────────────────────

  if (loading) {
    return <LoadingState variant="full" />;
  }

  if (error && !lastSavedAt) {
    return (
      <div
        className="flex h-screen flex-col items-center justify-center gap-3"
        style={{ background: 'var(--paper)' }}
      >
        <p className="text-base" style={{ color: 'var(--mark-red)' }}>{error}</p>
        <button
          className="text-base"
          style={{ color: 'var(--ink-faded)' }}
          onClick={goBack}
        >
          返回管理后台
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ background: 'var(--paper)' }}>
      <ThresholdOverlay visible={committing} label="正在提交版本..." />

      <main className="relative z-0 flex flex-1 flex-col overflow-hidden">
        {/* 顶栏：1fr | auto | 1fr 让 Portal 工具栏相对视口水平居中 */}
        <header
          className="grid shrink-0 items-center"
          style={{
            height: 48,
            padding: '8px 16px',
            gridTemplateColumns: '1fr auto 1fr',
            columnGap: 12,
          }}
        >
          {/* 左侧胶囊：返回导航 + 标题输入 */}
          <div
            className="flex min-w-0 shrink-0 items-center justify-self-start gap-2"
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
              className="hover-shelf shrink-0 rounded-md px-2 py-1 text-base transition-colors duration-150"
              style={{ color: 'var(--ink-faded)' }}
              onClick={goBack}
            >
              ←
            </button>
            <span
              className="shrink-0 text-base"
              style={{ color: 'var(--ink-ghost)' }}
            >
              /
            </span>
            <input
              type="text"
              value={state.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="条目标题"
              className="w-[160px] shrink-0 truncate border-none bg-transparent text-base font-medium outline-none placeholder:text-[var(--ink-ghost)]"
              style={{ color: 'var(--ink)' }}
            />
          </div>

          {/* 工具栏 Portal：中列，左右 1fr 均分剩余宽度 → 视觉中心落在视口中间 */}
          <div
            ref={setToolbarPortal}
            className="flex min-w-0 max-w-full justify-center justify-self-center overflow-x-auto"
          />

          {/* 右侧胶囊：状态指示 + 主题切换 + 操作按钮 */}
          <div
            className="flex min-w-0 shrink-0 items-center justify-self-end gap-3"
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
            <div
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--ink-ghost)' }}
            >
              {isAutosaving && <StatusDot color="var(--mark-blue)" />}
              {isDirty && !isAutosaving && <StatusDot color="var(--mark-red)" />}
              {!isDirty && !isAutosaving && lastSavedAt && (
                <StatusDot color="var(--mark-green)" />
              )}
              {lastSavedAt && (
                <span>
                  {new Date(lastSavedAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
              {autosaveError && (
                <span style={{ color: 'var(--mark-red)' }}>{autosaveError}</span>
              )}
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
              {/* 提交就近浮层:以「提交」Pill 为锚点弹出(⌘S 也走 showCommitDialog) */}
              <Popover open={showCommitDialog} onOpenChange={setShowCommitDialog}>
                <PopoverAnchor>
                  <ActionPill
                    label="提交"
                    shortcut="⌘S"
                    primary
                    onClick={() => setShowCommitDialog(true)}
                  />
                </PopoverAnchor>
                <PopoverContent align="end" sideOffset={6} className="w-72 p-3">
                  <CommitForm
                    changeNote={state.changeNote}
                    onChangeNote={(v) => handleChange('changeNote', v)}
                    onConfirm={() => void commitDraft()}
                    onCancel={() => setShowCommitDialog(false)}
                  />
                </PopoverContent>
              </Popover>
              <ActionPill label="丢弃" danger onClick={() => void discardDraft()} />
            </div>
          </div>
        </header>

        {error && lastSavedAt && (
          <div className="px-6 py-2" style={{ background: 'rgba(255,59,48,0.06)' }}>
            <p className="text-base" style={{ color: 'var(--mark-red)' }}>{error}</p>
          </div>
        )}

        {/* 内容区：编辑器 + 右侧大纲 */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左侧留白与 Outline 等宽，让编辑器 mx-auto 相对视口居中 */}
          <div className="shrink-0" style={{ width: 'var(--layout-sidebar)' }} />
          <div
            className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
            data-scroll-container
          >
            <div className="mx-auto w-full max-w-[var(--layout-editor-max)] pb-40 pt-10">
              {/*
               * DraftAssetProvider：PlateMarkdownEditor 依赖此 context 管理资产 URL 替换。
               * 条目可能包含图片，用 anthologyId 作 scope。
               */}
              <DraftAssetProvider contentItemId={id!}>
                <PlateMarkdownEditor
                  key={`anthology-entry-${id}-${entryKey}`}
                  initialMarkdown={state.bodyMarkdown}
                  onChange={(md) => handleChange('bodyMarkdown', md)}
                  toolbarContainer={toolbarPortal}
                />
              </DraftAssetProvider>
            </div>
          </div>

          {/* 右侧大纲面板 — 共享组件,与展示端笔记目录同步 */}
          <EditorOutline headings={headings} onJump={scrollToHeading} />
        </div>
      </main>

    </div>
  );
};

// ─── 提交就近浮层内容 ─────────────────────────────────────────────────────────

function CommitForm({
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
    <div>
      <div className="mb-0.5 text-md font-semibold" style={{ color: 'var(--ink)' }}>提交版本</div>
      <p className="mb-3 text-xs" style={{ color: 'var(--ink-ghost)' }}>将当前草稿提交为正式版本</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-2xs font-medium" style={{ color: 'var(--ink-ghost)' }}>变更说明</span>
        <Input
          type="text"
          value={changeNote}
          onChange={(e) => onChangeNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); }}
          autoFocus
        />
      </label>
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>取消</Button>
        <Button variant="primary" size="sm" type="button" onClick={onConfirm}>确认提交</Button>
      </div>
    </div>
  );
}

// ─── 原语组件 ────────────────────────────────────────────────────────────────

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
      className="rounded-md px-2.5 py-1 text-base transition-all duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontWeight: primary ? 600 : 400,
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!danger) e.currentTarget.style.background = 'var(--shelf)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      title={shortcut}
    >
      {label}
    </button>
  );
}

export default AnthologyEntryEditPage;
