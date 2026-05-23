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
import { notesApi as contentItemsApi } from '@/services/workspace';
import type { ContentChangeType, ContentDetail, EditorDraft } from '@/services/workspace';
import { PlateMarkdownEditor } from './components/PlateEditor';
import { parseError } from './helpers';
import { type HeadingEntry, extractHeadingEntriesFromMarkdown } from './lib/markdown-toc';
import { useLocalDraftBuffer } from './lib/use-local-draft-buffer';
import { EditorOutline } from './components/EditorOutline';
import { CommitForm } from './components/CommitForm';
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

const DraftEditPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();

  /**
   * 安全返回:有 app 内上一页就回退(保留原来的精确返回),否则去管理后台。
   * 修复"有时候点返回页面出错"——直接打开/刷新过编辑页时 navigate(-1) 会退到
   * app 外或坏页(location.key 为 'default' 即没有 app 内历史)。
   */
  const goBack = useCallback(() => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/admin/notes');
  }, [location.key, navigate]);

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
  // local-first 草稿缓冲:每次改动即时落 localStorage,崩溃/刷新/关页不丢字
  const {
    loadPending: loadLocalPending,
    onChange: writeLocalDraft,
    beginSync: beginLocalSync,
    endSync: endLocalSync,
    clear: clearLocalDraft,
  } = useLocalDraftBuffer<EditorState>(id ?? null);
  const [, setAutosaveError] = useState(''); // 值未在笔记编辑器展示,只保留 setter 供 saveDraft 调用
  const [resetKey] = useState(0);
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  /* Portal 目标：Plate 工具栏通过 Portal 渲染到此元素内 */
  // 固定工具栏已移除（Notion 风格），格式化通过浮动工具栏和 / 命令完成

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
          console.error('[DraftEditPage] 获取草稿失败, 视为无草稿:', err);
          // 草稿不存在或请求失败均视为无草稿，继续加载正式版本
        }

        if (cancelled) return;

        let loaded: EditorState | null = null;
        if (draft) {
          // 有草稿：直接恢复，不请求正式版（避免多余请求）
          loaded = {
            title: draft.title,
            summary: draft.summary,
            bodyMarkdown: draft.bodyMarkdown,
            changeNote: draft.changeNote,
            changeType: 'patch',
          };
          setState(loaded);
          setLastSavedAt(draft.savedAt);
        } else {
          // 无草稿：只加载正式版,不急着建草稿。打开本身不算保存——
          // 首次真实编辑触发自动保存时才创建草稿(saveDraft 是 upsert),时间戳才是真实保存时刻。
          const detail = await contentItemsApi.getById(id, { visibility: 'all' });
          if (cancelled) return;
          setContentDetail(detail);
          loaded = {
            title: detail.latestVersion.title,
            summary: detail.latestVersion.summary,
            bodyMarkdown: detail.bodyMarkdown,
            changeNote: '更新内容',
            changeType: 'patch',
          };
          setState(loaded);
          // 不 setLastSavedAt:还没有草稿,无"已自动保存"时间(用户编辑后才有)
        }

        // local-first reconcile:本地缓存"存在即未同步"(成功同步会清空)。有未同步内容
        // (上次没存完就崩了/刷新了)→ 恢复并标脏重传,无需再和服务器逐字比对。
        const localPending = loadLocalPending();
        if (localPending && !cancelled) {
          setState(localPending);
          setIsDirty(true);
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
  }, [id, loadLocalPending]);

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

      // local-first:抓同步 token,成功后仅在期间无新改动时标记本地已同步(防竞态)
      const syncToken = beginLocalSync();
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
        endLocalSync(syncToken);

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
    [id, state, beginLocalSync, endLocalSync],
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
      clearLocalDraft(); // 已提交,本地草稿失效,清掉防下次打开被当未同步草稿恢复
      setContentDetail(saved);
      setIsDirty(false);
      setLastSavedAt('');

      // 提交成功后立即跳转（页面跳转本身就是成功反馈）
      navigateTimerRef.current = window.setTimeout(() => goBack(), 800);
    } catch (commitError) {
      setCommitting(false);
      setError(parseError(commitError, '提交失败'));
    }
  }, [id, state, goBack, clearLocalDraft]);

  const discardDraft = useCallback(async () => {
    if (!id) return;
    const ok = await confirm({ title: '丢弃草稿', message: '确认丢弃当前草稿？', danger: true, confirmLabel: '丢弃' });
    if (!ok) return;

    try {
      await contentItemsApi.deleteDraft(id);
      clearLocalDraft(); // 已丢弃,清本地草稿
      goBack();
    } catch (discardError) {
      setError(parseError(discardError, '丢弃失败'));
    }
  }, [id, goBack, confirm, clearLocalDraft]);

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

  // local-first:每次改动即时镜像到 localStorage(零延迟,崩溃/刷新也不丢字)
  useEffect(() => {
    if (loading || !isDirty) return;
    writeLocalDraft(state);
  }, [state, isDirty, loading, writeLocalDraft]);

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
        <p className="text-base" style={{ color: 'var(--mark-red)' }}>{error}</p>
        <button className="text-base" style={{ color: 'var(--ink-faded)' }} onClick={goBack}>
          返回管理后台
        </button>
      </div>
    );
  }

  /*
   * CSS Grid 三栏布局（Notion 风格）：
   *   列：AI 面板 | 编辑器 | 大纲
   *   行：顶栏(36px) | 内容(1fr)
   */
  const gridColumns = 'clamp(18rem, 22vw, 22rem) 1fr var(--layout-sidebar)';

  return (
    <div
      className="grid h-screen overflow-hidden"
      style={{
        background: 'var(--paper)',
        gridTemplateColumns: gridColumns,
        gridTemplateRows: '52px 1fr',
      }}
    >
      <ThresholdOverlay visible={committing} label="正在提交版本..." />

      {/* ── Row 1: Notion 风格顶栏（无底边框，与内容自然融合） ── */}
      <div className="col-span-full flex items-center justify-between px-4">
        {/* 左：← + 可编辑页面名 */}
        <div className="flex items-center gap-1.5">
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
            placeholder="无标题"
            className="input-ghost min-w-[60px] max-w-[280px] truncate text-base font-medium placeholder:text-[var(--ink-ghost)]"
            style={{ color: 'var(--ink)' }}
          />
        </div>

        {/* 右：状态 + 保存(ghost) + 提交(中性胶囊→就近浮层) + … 菜单(主题/丢弃);按钮统一用设计系统 <Button> */}
        <div className="flex items-center gap-1.5">
          {/* 自动保存状态:保存中(长春花紫呼吸点强调) / 未保存 / 已自动保存 hh:mm */}
          <span className="mr-1 inline-flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            {isAutosaving && (
              <span className="size-1.5 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} aria-hidden />
            )}
            {isAutosaving ? '保存中…' : isDirty ? '未保存' :
             lastSavedAt ? `已自动保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>

          {/* 保存:ghost(轻),直接快捷(⇧⌘S);字号 text-base(13px)压过基类 text-md,顶栏更轻、从属于 15px 正文 */}
          <Button variant="ghost" size="default" className="text-base" onClick={() => void saveDraft()} title="保存 ⇧⌘S">
            保存
          </Button>

          {/* 提交:secondary 中性胶囊(paper-dark 淡底,非色块);点开就近浮层,长春花紫只用在浮层里"确认提交"(认知关口)。⌘S 也走 showCommitDialog */}
          <Popover open={showCommitDialog} onOpenChange={setShowCommitDialog}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="default" className="text-base">提交</Button>
            </PopoverTrigger>
            {/* 浮层容器与 ⋯ 菜单同基准:w-64=256、圆角 xl、细边、柔阴影、入场动画 */}
            <PopoverContent align="end" sideOffset={6} className="w-64 p-3">
              <CommitForm
                changeNote={state.changeNote}
                onChangeNote={(v) => handleChange('changeNote', v)}
                onConfirm={() => void commitDraft()}
                onCancel={() => setShowCommitDialog(false)}
              />
            </PopoverContent>
          </Popover>

          {/* … 菜单:切换主题 / 丢弃(危险) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none data-[state=open]:bg-[var(--shelf)]" style={{ color: 'var(--ink-ghost)' }} title="更多">
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

      {/* 编辑器 */}
      <div className="min-w-0 overflow-y-auto overflow-x-hidden" data-scroll-container>
        {error && contentDetail && (
          <div className="px-6 py-2" style={{ background: 'rgba(255,59,48,0.06)' }}>
            <p className="text-sm" style={{ color: 'var(--mark-red)' }}>{error}</p>
          </div>
        )}
        <div className="mx-auto w-full max-w-[var(--layout-editor-max)] pb-40">
          <DraftAssetProvider contentItemId={id!}>
            <PlateMarkdownEditor
              key={`${id}-${resetKey}`}
              initialMarkdown={state.bodyMarkdown}
              onChange={(md, isUserEdit) => {
                // 始终同步正文(让 state 与编辑器一致),但仅用户真实编辑才标脏触发自动保存——
                // 加载时 Plate 的规范化/往返不算编辑,不能让"打开页面"更新保存时间戳。
                setState((prev) => (prev.bodyMarkdown === md ? prev : { ...prev, bodyMarkdown: md }));
                if (isUserEdit) {
                  setIsDirty(true);
                  setAutosaveError('');
                }
              }}
            />
          </DraftAssetProvider>
        </div>
      </div>

      {/* [2,3] 大纲 — 共享组件,与展示端笔记目录同步 */}
      <EditorOutline headings={headings} onJump={scrollToHeading} />

    </div>
  );
};

export default DraftEditPage;
