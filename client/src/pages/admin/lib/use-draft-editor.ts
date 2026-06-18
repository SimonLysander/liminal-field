/*
 * useDraftEditor — 「文稿编辑」核心(笔记 / 文集条目共用)。
 *
 * 收编两类文稿编辑页逐字相同的逻辑:state、加载(草稿优先→正式版)、
 * 1.5s debounce 自动保存、local-first 草稿缓冲、提交、丢弃、⌘S/⇧⌘S、大纲提取。
 * 场景差异(标识 / 数据接口 / 透传字段 / 返回路径)全部通过 adapter 注入。
 *
 * 不含:三栏布局、AdvisorSidebar(见 ProseDraftEditor)。agent 上下文是场景相关的,
 * 由各页面构造后注入布局,不属于「文稿编辑」内核。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useConfirm } from '@/contexts/ConfirmContext';
import { parseError } from '../helpers';
import { type HeadingEntry, extractHeadingEntriesFromMarkdown } from './markdown-toc';
import { useLocalDraftBuffer } from './use-local-draft-buffer';

/** 文稿草稿的最小字段(笔记 / 文集条目共有)。场景可扩展(如笔记的 summary / changeType) */
export interface BaseDraftState {
  title: string;
  bodyMarkdown: string;
  changeNote: string;
}

/**
 * 场景适配器:把「文稿编辑」内核里随场景而变的部分注入进来。
 * TState 是该场景的完整草稿字段(在 BaseDraftState 上扩展)。
 */
export interface DraftEditorAdapter<TState extends BaseDraftState> {
  /** 标识是否齐全(如 notes 的 id、anthology 的 id+entryKey 都在),不齐全不加载 */
  ready: boolean;
  /** 本地草稿缓冲 key(唯一标识这份草稿;null = 不缓冲) */
  storageKey: string | null;
  /** 初始空 state(含场景特有字段的默认值) */
  initialState: TState;
  /** 加载草稿;无草稿返回 null。savedAt 用于"已自动保存"时间 */
  loadDraft: () => Promise<{ state: TState; savedAt: string } | null>;
  /** 加载正式版(无草稿时);此时尚无草稿,故无 savedAt */
  loadPublished: () => Promise<TState>;
  /** 保存草稿(upsert),返回 savedAt */
  saveDraft: (state: TState) => Promise<{ savedAt: string }>;
  /** 提交发布(后端通常自动删草稿) */
  commit: (state: TState) => Promise<void>;
  /** 丢弃草稿 */
  discard: () => Promise<void>;
  /** 返回兜底路径(无 app 内历史时) */
  fallbackPath: string;
  /** 文案(随场景:笔记 vs 条目) */
  labels?: { loadError?: string; saveError?: string; commitError?: string; discardError?: string };
}

/** useDraftEditor 的返回类型(供 ProseDraftEditor 等消费方泛型引用) */
export type DraftEditorController<TState extends BaseDraftState> = ReturnType<typeof useDraftEditor<TState>>;

/** 从 document.referrer 找一条比 fallback 更精准的返回路径,失败一律走 fallback */
function resolveBackPath(fallback: string): string {
  if (typeof document === 'undefined' || typeof window === 'undefined') return fallback;
  const ref = document.referrer;
  if (!ref) return fallback;
  try {
    const refUrl = new URL(ref);
    if (refUrl.origin !== window.location.origin) return fallback;
    if (!refUrl.pathname.startsWith('/admin/')) return fallback;
    // 排除从另一个 edit 页跳过来,避免返回又落到编辑器形成"返回即原页"
    if (refUrl.pathname.endsWith('/edit')) return fallback;
    return refUrl.pathname + refUrl.search;
  } catch {
    return fallback;
  }
}

export function useDraftEditor<TState extends BaseDraftState>(adapter: DraftEditorAdapter<TState>) {
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();

  // adapter 每次渲染是新对象,但其函数闭包捕获的是最新标识/state。用 ref 取最新,
  // 避免把 adapter 放进各 callback 依赖导致引用频繁变化。
  // (在 effect 里同步,而非 render 中直接赋值 ref——后者违反 react-hooks/refs)
  const adapterRef = useRef(adapter);
  useEffect(() => {
    adapterRef.current = adapter;
  }, [adapter]);

  const labels = adapter.labels;

  /** 安全返回:有 app 内上一页就回退,否则去兜底路径(直接打开/刷新时 navigate(-1) 会退到坏页)。
   *  hard refresh(列表用 window.location.href 跳进编辑页,导致 history 重置 → location.key='default')
   *  的情况:再用 document.referrer 兜一层,避免 fallbackPath 丢钻入位置(admin ?at= 没了就回根列表)。
   *  referer 只接受同源 + /admin/ 列表页(排除 /edit 防循环)。
   *
   *  isDirty 时先 confirm 一下避免误操作（localStorage 兜底，技术上不丢字，
   *  但有改动还没存到服务端用户可能希望先 ⌘S）。 */
  const isDirtyRef = useRef(false);
  const goBack = useCallback(() => {
    void (async () => {
      if (isDirtyRef.current) {
        const ok = await confirm({
          title: '有未保存的改动',
          message: '草稿已自动保存在本地，服务端版本可能还是旧的。要离开吗？',
          confirmLabel: '离开',
        });
        if (!ok) return;
      }
      if (location.key !== 'default') {
        navigate(-1);
        return;
      }
      navigate(resolveBackPath(adapterRef.current.fallbackPath));
    })();
  }, [confirm, location.key, navigate]);

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false); // 是否成功加载过内容(用于区分"加载失败"全屏错误 vs 加载后保存类错误条)
  const [error, setError] = useState('');
  const [state, setState] = useState<TState>(adapter.initialState);
  const [isDirty, setIsDirty] = useState(false);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [autosaveError, setAutosaveError] = useState('');
  const [showCommitDialog, setShowCommitDialog] = useState(false);
  const [committing, setCommitting] = useState(false);

  // local-first 草稿缓冲:每次改动即时落 localStorage,崩溃/刷新/关页不丢字
  const {
    loadPending: loadLocalPending,
    onChange: writeLocalDraft,
    beginSync: beginLocalSync,
    endSync: endLocalSync,
    clear: clearLocalDraft,
  } = useLocalDraftBuffer<TState>(adapter.storageKey);

  /* 大纲:从 markdown 提取标题层级(跳过代码块) */
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
        el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 64;
      container.scrollTo({ top, behavior: 'smooth' });
    }
    // 跳转后目标标题闪一下(toc-flash 动画),提示落点——与展示端阅读大纲一致
    el.classList.remove('toc-highlight');
    void el.offsetWidth; // 强制 reflow,确保重复点击同一项也能重放动画
    el.classList.add('toc-highlight');
    el.addEventListener(
      'animationend',
      () => el.classList.remove('toc-highlight'),
      { once: true },
    );
  }, []);

  /*
   * 大纲高亮 scroll-spy:监听编辑器滚动容器,找"顶部已划过阈值的最后一个标题"作为当前项。
   * 阈值取容器顶 +72(略大于 scrollToHeading 的 -64 偏移,保证点击跳转后该标题即被高亮)。
   * 与展示端阅读大纲同思路(见 note/index.tsx handleScroll)。
   */
  const [activeHeadingIndex, setActiveHeadingIndex] = useState(0);
  useEffect(() => {
    const container = document.querySelector(
      '[data-scroll-container]',
    ) as HTMLElement | null;
    if (!container) return;
    const onScroll = () => {
      const els = document.querySelectorAll(
        '[data-slate-editor] h1, [data-slate-editor] h2, [data-slate-editor] h3',
      );
      if (els.length === 0) return;
      const threshold = container.getBoundingClientRect().top + 72;
      let active = 0;
      for (let i = els.length - 1; i >= 0; i--) {
        if ((els[i] as HTMLElement).getBoundingClientRect().top <= threshold) {
          active = i;
          break;
        }
      }
      setActiveHeadingIndex((prev) => (prev === active ? prev : active));
    };
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
    // headings.length 变化(内容加载/增删标题)时重新校准
  }, [headings.length]);

  /** 单字段更新:标脏 + 清自动保存错误 */
  const setField = useCallback(<K extends keyof TState>(key: K, value: TState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    setAutosaveError('');
  }, []);

  /** 整体替换 state(供编辑器正文 onChange:仅在变化时更新,加载规范化往返不标脏) */
  const setBody = useCallback((bodyMarkdown: string, isUserEdit: boolean) => {
    setState((prev) => (prev.bodyMarkdown === bodyMarkdown ? prev : { ...prev, bodyMarkdown }));
    if (isUserEdit) {
      setIsDirty(true);
      setAutosaveError('');
    }
  }, []);

  // ─── 初始化:草稿优先 → 正式版;本地未同步内容(上次没存完)覆盖并标脏 ───
  // 依赖 ready + storageKey:标识齐全或切换到另一份草稿时重载。
  useEffect(() => {
    if (!adapter.ready) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError('');
      try {
        let draft: { state: TState; savedAt: string } | null = null;
        try {
          draft = await adapterRef.current.loadDraft();
        } catch (err) {
          console.error('[useDraftEditor] 获取草稿失败, 视为无草稿:', err);
          // 草稿不存在或请求失败均视为无草稿,继续加载正式版
        }
        if (cancelled) return;

        if (draft) {
          setState(draft.state);
          setLastSavedAt(draft.savedAt);
        } else {
          // 无草稿:只读正式版,不急着建草稿。首次真实编辑触发自动保存时才建(saveDraft 是 upsert),
          // 时间戳才是真实保存时刻。
          const published = await adapterRef.current.loadPublished();
          if (cancelled) return;
          setState(published);
          // 不 setLastSavedAt:还没有草稿,无"已自动保存"时间(用户编辑后才有)
        }

        // local-first reconcile:本地缓存"存在即未同步"(成功同步会清空)。有未同步内容
        // (上次没存完就崩了/刷新了)→ 恢复并标脏重传,无需再和服务器逐字比对。
        const localPending = loadLocalPending();
        if (localPending && !cancelled) {
          setState(localPending);
          setIsDirty(true);
        }
        if (!cancelled) setLoaded(true);
      } catch (initError) {
        if (!cancelled) setError(parseError(initError, labels?.loadError ?? '加载内容失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // adapter.ready / storageKey 是标识变化的代理;loadLocalPending 随 storageKey 变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter.ready, adapter.storageKey, loadLocalPending]);

  // ─── 草稿保存(⇧⌘S 手动 / debounce 自动) ───
  const saveDraft = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!adapterRef.current.ready) return;
      if (options?.silent) {
        setIsAutosaving(true);
        setAutosaveError('');
      }
      // local-first:抓同步 token,成功后仅在期间无新改动时标记本地已同步(防竞态)
      const startedAt = Date.now();
      const syncToken = beginLocalSync();
      try {
        const { savedAt } = await adapterRef.current.saveDraft(state);
        setIsDirty(false);
        setLastSavedAt(savedAt);
        endLocalSync(syncToken);
        // 自动保存:让"保存中"至少停留 ~800ms,否则呼吸点一闪而过(存盘常 ~50ms)
        if (options?.silent) {
          const remain = 800 - (Date.now() - startedAt);
          if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
        }
        setIsAutosaving(false);
      } catch (saveError) {
        setIsAutosaving(false);
        if (options?.silent) setAutosaveError(parseError(saveError, labels?.saveError ?? '自动保存失败'));
        else setError(parseError(saveError, labels?.saveError ?? '保存失败'));
      }
    },
    [state, beginLocalSync, endLocalSync, labels],
  );

  // ─── 提交 ───
  const navigateTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(navigateTimerRef.current), []);

  const commitDraft = useCallback(async () => {
    if (!adapterRef.current.ready) return;
    setCommitting(true);
    setShowCommitDialog(false);
    try {
      await adapterRef.current.commit(state);
      clearLocalDraft(); // 已提交,本地草稿失效,清掉防下次打开被当未同步草稿恢复
      setIsDirty(false);
      setLastSavedAt('');
      // 提交成功后立即跳转(页面跳转本身就是成功反馈)
      navigateTimerRef.current = window.setTimeout(() => goBack(), 800);
    } catch (commitError) {
      setCommitting(false);
      setError(parseError(commitError, labels?.commitError ?? '提交失败'));
    }
  }, [state, goBack, clearLocalDraft, labels]);

  // ─── 丢弃草稿 ───
  const discardDraft = useCallback(async () => {
    if (!adapterRef.current.ready) return;
    const ok = await confirm({ title: '丢弃草稿', message: '确认丢弃当前草稿？', danger: true, confirmLabel: '丢弃' });
    if (!ok) return;
    try {
      await adapterRef.current.discard();
      clearLocalDraft(); // 已丢弃,清本地草稿
      // 主动清 isDirty + ref,避免 goBack 看到 dirty 又弹一次"有未保存改动"
      // confirm（discardDraft 自身已经 confirm 过丢弃了）
      setIsDirty(false);
      isDirtyRef.current = false;
      goBack();
    } catch (discardError) {
      setError(parseError(discardError, labels?.discardError ?? '丢弃失败'));
    }
  }, [confirm, goBack, clearLocalDraft, labels]);

  // ⌘S 打开提交浮层 / ⇧⌘S 直接保存草稿
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

  // 离开页面（关 tab / 刷新 / 关浏览器）时 beforeunload 提示。
  // localStorage 即时镜像兜底，技术上不会丢字；但 1.5s debounce 窗口内
  // 服务端版本是旧的，提示让用户体感更安全（也提醒"有改动还没存"）。
  // 同时镜像 isDirty 到 ref，给上面 goBack 用（避免 isDirty 进 useCallback deps
  // 让 goBack identity 每次 setIsDirty 都变 → re-render advisor / 编辑器栏）。
  useEffect(() => {
    isDirtyRef.current = isDirty;
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // local-first:每次改动即时镜像到 localStorage(零延迟,崩溃/刷新也不丢字)
  useEffect(() => {
    if (loading || !isDirty) return;
    writeLocalDraft(state);
  }, [state, isDirty, loading, writeLocalDraft]);

  // 1.5s debounce 自动保存
  useEffect(() => {
    if (!isDirty || loading) return;
    const timer = window.setTimeout(() => void saveDraft({ silent: true }), 1500);
    return () => window.clearTimeout(timer);
  }, [isDirty, loading, saveDraft]);

  return {
    state,
    setField,
    setBody,
    loading,
    loaded,
    error,
    isDirty,
    isAutosaving,
    lastSavedAt,
    autosaveError,
    showCommitDialog,
    setShowCommitDialog,
    committing,
    saveDraft,
    commitDraft,
    discardDraft,
    headings,
    scrollToHeading,
    activeHeadingIndex,
    goBack,
  };
}
