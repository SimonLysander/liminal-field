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
import { ChevronLeft, Sun, Trash2, MoreHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/hooks/use-theme';
import { anthologyApi } from '@/services/workspace';
import type { EditorDraft } from '@/services/workspace';
import { PlateMarkdownEditor } from '../components/PlateEditor';
import { parseError } from '../helpers';
import { type HeadingEntry, extractHeadingEntriesFromMarkdown } from '../lib/markdown-toc';
import { EditorOutline } from '../components/EditorOutline';
import { CommitForm } from '../components/CommitForm';
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
            height: 52,
            padding: '8px 16px',
            gridTemplateColumns: '1fr auto 1fr',
            columnGap: 12,
          }}
        >
          {/* 左组：扁平，ChevronLeft 返回 + input-ghost 标题 */}
          <div className="flex min-w-0 shrink-0 items-center justify-self-start gap-1.5">
            <button
              className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none"
              style={{ color: 'var(--ink-faded)' }}
              onClick={goBack}
              aria-label="返回"
            >
              <ChevronLeft size={18} strokeWidth={1.5} />
            </button>
            <input
              type="text"
              value={state.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="条目标题"
              className="input-ghost min-w-[60px] max-w-[240px] truncate text-base font-medium placeholder:text-[var(--ink-ghost)]"
              style={{ color: 'var(--ink)' }}
            />
          </div>

          {/* 工具栏 Portal：中列，左右 1fr 均分剩余宽度 → 视觉中心落在视口中间 */}
          <div
            ref={setToolbarPortal}
            className="flex min-w-0 max-w-full justify-center justify-self-center overflow-x-auto"
          />

          {/* 右组：扁平，文字状态 + 保存(ghost) + 提交(secondary→浮层) + ⋯ DropdownMenu */}
          <div className="flex items-center gap-1.5 justify-self-end">
            {/* 文字状态：保存中 / 未保存 / 上次编辑 hh:mm */}
            <span className="mr-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
              {isAutosaving
                ? '保存中...'
                : isDirty
                  ? '未保存'
                  : lastSavedAt
                    ? `上次编辑 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
            </span>
            {autosaveError && (
              <span className="text-xs" style={{ color: 'var(--mark-red)' }}>
                {autosaveError}
              </span>
            )}

            {/* 保存：ghost 轻量，快捷键 ⇧⌘S */}
            <Button variant="ghost" size="default" onClick={() => void saveDraft()} title="保存 ⇧⌘S">
              保存
            </Button>

            {/* 提交：secondary 中性，点开就近浮层（⌘S 也走 showCommitDialog） */}
            <Popover open={showCommitDialog} onOpenChange={setShowCommitDialog}>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="default">提交</Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-64 p-3">
                <CommitForm
                  changeNote={state.changeNote}
                  onChangeNote={(v) => handleChange('changeNote', v)}
                  onConfirm={() => void commitDraft()}
                  onCancel={() => setShowCommitDialog(false)}
                />
              </PopoverContent>
            </Popover>

            {/* ⋯ 菜单：切换主题 / 丢弃草稿（危险） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none data-[state=open]:bg-[var(--shelf)]"
                  style={{ color: 'var(--ink-ghost)' }}
                  title="更多"
                >
                  <MoreHorizontal size={18} strokeWidth={1.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTheme(theme === 'daylight' ? 'midnight' : 'daylight')}>
                  <Sun />切换主题
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void discardDraft()}
                  className="text-[var(--danger)] focus:bg-[color-mix(in_srgb,var(--danger)_9%,transparent)] [&_svg]:text-[var(--danger)]"
                >
                  <Trash2 />丢弃草稿
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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

export default AnthologyEntryEditPage;
