/*
 * Sidebar — Display page navigation (Apple Books style)
 *
 * Design decisions:
 *   - Floating card pattern: sidebar-bg (#F2F2F2) background with 8px margin,
 *     radius-lg (10px) corners, and shadow-sm elevation. This creates a
 *     card-like panel that "floats" off the white page background, matching
 *     Apple Books' left panel aesthetic.
 *   - Fixed 200px width: identical to admin TreePanel for visual consistency
 *     when switching between display and admin views.
 *   - Lucide icons (size=16, strokeWidth=1.5): unified icon style across all
 *     navigation items for a clean, consistent feel.
 *   - Notes sub-nav uses breadcrumb drill-down instead of a tree, since
 *     useParams() doesn't work outside <Routes> — we parse location.pathname
 *     directly to extract the active noteId.
 */

import { useEffect, useRef, useState } from 'react';
import { useSearchHotkey } from '@/hooks/use-search-hotkey';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { SearchPanel } from '@/components/global/SearchPanel';
import { structureApi } from '@/services/structure';
import type { StructureNode } from '@/services/structure';
import { anthologyApi } from '@/services/workspace';
import type { AnthologyPublicListItem, AnthologyPublicDetail } from '@/services/workspace';
import { FileText, Search, ChevronLeft } from 'lucide-react';
import { type Space, spaces, labels, NavIcons, spaceToPath, pathToSpace } from './nav-spaces';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { LoadingState } from '@/components/LoadingState';

/* ---------- Data ---------- */

/* Space / spaces / labels / NavIcons / spaceToPath / pathToSpace
 * 均从 nav-spaces 共享模块导入（Sidebar 与 BottomTabBar 单一来源）。 */

function getAmbientPhrase() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，灵感不睡';
  if (h < 9) return '早晨的光很适合写字';
  if (h < 12) return '上午好，慢慢来';
  if (h < 14) return '午后，思绪沉淀中';
  if (h < 17) return '下午的时间最长';
  if (h < 19) return '傍晚，收集今天的碎片';
  if (h < 22) return '晚上好，记录一些什么吧';
  return '夜晚适合回看';
}

/* ---------- Notes tree navigation ---------- */

type BreadcrumbItem = { id: string; name: string };

function useStructureLevel(parentId: string | undefined) {
  const [nodes, setNodes] = useState<StructureNode[]>([]);
  /* SWR 模式(与 useAnthologyLevel 对齐):
   *   - loaded 只在首次成功 fetch 后翻 true,之后切层不再回 false
   *   - 切换 parentId 时旧 nodes 保留到新数据到达 → 不闪 LoadingState
   *   - AnimatePresence 因 motion.div 始终在场而能完整跑 exit+enter(钻入动画) */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;

      const req = parentId
        ? structureApi.getChildren(parentId, { visibility: 'public', scope: 'notes' })
        : structureApi.getRootNodes({ visibility: 'public', scope: 'notes' });

      try {
        const result = await req;
        if (!cancelled) setNodes(result.children);
      } catch (err) {
        console.error('[Sidebar] 结构节点加载失败:', err);
        // 结构节点加载失败时静默降级为空列表
        if (!cancelled) setNodes([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parentId]);

  return { nodes, loading: !loaded };
}

/* ---------- Anthology sub-nav data ----------
 * 镜像笔记 useStructureLevel:
 *   - anthologyId=null  → 拉文集列表(根层)
 *   - anthologyId=cixxx → 拉该文集的篇章列表(钻入层)
 */
function useAnthologyLevel(anthologyId: string | null) {
  const [items, setItems] = useState<
    Array<{ nodeId: string; title: string }>
  >([]);
  /* 钻入态额外返回当前文集标题,给面包屑「← 文集 / <文集名>」用 */
  const [containerTitle, setContainerTitle] = useState<string | null>(null);
  /* loaded 只在首次成功 fetch 后翻 true,之后切换 anthologyId 不再 set false →
   * 后续切换走 stale-while-revalidate:旧 items 留在视图,新数据到达 atomic 替换。
   * 避免每次切层都闪 LoadingState 一帧。 */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      try {
        if (anthologyId) {
          /* 钻入态:拉该文集的 entries + 标题 */
          const detail: AnthologyPublicDetail =
            await anthologyApi.getPublicDetail(anthologyId);
          if (!cancelled) {
            setItems(
              detail.entries.map((e) => ({ nodeId: e.nodeId, title: e.title })),
            );
            setContainerTitle(detail.title);
          }
        } else {
          /* 根态:拉文集列表,无 containerTitle */
          const list: AnthologyPublicListItem[] =
            await anthologyApi.listPublished();
          if (!cancelled) {
            setItems(list.map((a) => ({ nodeId: a.id, title: a.title })));
            setContainerTitle(null);
          }
        }
      } catch (err) {
        console.error('[Sidebar] 文集 sub-nav 加载失败:', err);
        if (!cancelled) {
          setItems([]);
          setContainerTitle(null);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anthologyId]);

  return { items, containerTitle, loading: !loaded };
}

/* ---------- Component ---------- */

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = pathToSpace(location.pathname);

  /* ── 全局搜索 ⌘K ────────────────────────────────── */
  const { searchOpen, setSearchOpen } = useSearchHotkey();

  /* query params 直接读 at / node,无需 regex 解析 pathname:
   *   at   = ancestor topic,当前钻入的文件夹节点 id(用于推 currentParentId)
   *   node = 当前选中/打开的内容节点 id(叶子文档或主题正文) */
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTopicId = searchParams.get('at');
  const activeNoteId = searchParams.get('node');


  /* 笔记树导航状态
   *
   * currentParentId 直接从 URL 的 activeTopicId 推导，而非从 breadcrumb state。
   * 这样直接加载 /note/topic/:id 时，节点列表立即用正确层级请求，
   * 不会先闪一次根层级（admin 侧同款架构：URL 是唯一真相源）。
   *
   * breadcrumb state 仅用于面包屑 UI 展示（回退按钮和路径段），
   * useEffect 负责将 URL → breadcrumb state 同步（异步，可接受短暂落后）。
   */
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  /* 导航方向：1 = 进入更深层（右滑入），-1 = 返回上层（左滑入） */
  const navDirection = useRef(1);
  // 导航方向仅用于子菜单切换动画的方向初值；用 ref 避免方向变化触发额外渲染，
  // 渲染期读取该值不影响渲染正确性，故局部关闭 react-hooks/refs。
  /* eslint-disable-next-line react-hooks/refs */
  const navEnterX = navDirection.current * 20;
  /* eslint-disable-next-line react-hooks/refs */
  const navExitX = navDirection.current * -20;
  const currentParentId = activeTopicId ?? undefined;
  const { nodes: currentNodes, loading: notesLoading } = useStructureLevel(currentParentId);

  /* 文集 sub-nav 状态:
   *   /anthology              → 根:列文集
   *   /anthology?node=cixxx   → 钻入(Overview):列该文集篇章,无当前章节
   *   /anthology?at=cixxx&node=ciyyy → 钻入(EntryReader):列篇章 + node 高亮 */
  const anthologyContainerId = active === 'anthology'
    ? (activeTopicId ?? activeNoteId ?? null)
    : null;
  /* at 存在 = EntryReader 态,node 是被高亮的章节;只 node 无 at = Overview 态,不高亮 */
  const anthologyActiveEntry = active === 'anthology' && activeTopicId
    ? activeNoteId
    : null;
  const {
    items: anthologyItems,
    containerTitle: anthologyContainerTitle,
    loading: anthologyLoading,
  } = useAnthologyLevel(anthologyContainerId);

  /* URL → breadcrumb state 同步（仅用于 UI 展示，不参与节点请求）
   *   /note/:noteId        → 通过 contentItemId 反查完整路径
   *   /note/topic/:topicId → 通过 nodeId 反查完整路径
   *   /note                → 根级别，清空 breadcrumb */
  useEffect(() => {
    if (active !== 'notes') return;
    let cancelled = false;

    if (activeNoteId) {
      structureApi.getPathByContentItemId(activeNoteId).then((path) => {
        if (cancelled) return;
        const folders = path
          .filter((n) => n.type === 'FOLDER')
          .map((n) => ({ id: n.id, name: n.name }));
        setBreadcrumb(folders);
        // 从首页/分享 URL 跳来时只带 ?node=xxx,没 at= → 节点列表停在根级。
        // 反查 path 后,如果发现 node 在某个 folder 里,把 at 补到 URL 里
        // (replace 不污染历史),让 currentParentId 自然推到对应 folder,
        // 节点列表自动加载该层 + 当前 node 高亮。
        if (!activeTopicId && folders.length > 0) {
          const last = folders[folders.length - 1];
          setSearchParams(
            { at: last.id, node: activeNoteId },
            { replace: true },
          );
        }
      }).catch((err) => {
        console.error('[Sidebar] 面包屑路径加载失败:', err);
        // 面包屑路径加载失败不影响页面功能，静默降级
      });
    } else if (activeTopicId) {
      structureApi.getPathByNodeId(activeTopicId).then((path) => {
        if (cancelled) return;
        const folders = path
          .filter((n) => n.type === 'FOLDER')
          .map((n) => ({ id: n.id, name: n.name }));
        setBreadcrumb(folders);
      }).catch((err) => {
        console.error('[Sidebar] 面包屑路径加载失败:', err);
        // 面包屑路径加载失败不影响页面功能，静默降级
      });
    } else {
      void Promise.resolve().then(() => {
        if (!cancelled) setBreadcrumb([]);
      });
    }

    return () => { cancelled = true; };
  }, [activeNoteId, activeTopicId, active, setSearchParams]);

  const handleNavigate = (space: Space) => {
    navigate(spaceToPath(space));
  };

  /* 进入文件夹:立即追加 breadcrumb(UI 即时反馈),URL 只写 at(钻入文件夹 id) */
  const enterFolder = (node: StructureNode) => {
    navDirection.current = 1;
    setBreadcrumb((prev) => [...prev, { id: node.id, name: node.name }]);
    navigate(`/note?at=${node.id}`);
  };

  /* 面包屑回退：只改 URL，state 由 useEffect 同步 */
  const goToBreadcrumb = (index: number | null) => {
    navDirection.current = -1;
    if (index === null) {
      navigate('/note');
    } else {
      navigate(`/note?at=${breadcrumb[index].id}`);
    }
  };

  const isGallery = active === 'gallery';

  return (
    <aside
      className="hidden md:flex shrink-0 flex-col overflow-y-auto rounded-lg"
      style={{
        width: 'var(--layout-sidebar)',
        background: 'var(--sidebar-bg)',
        margin: '12px 0 12px 12px',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Header — gallery 沉浸模式隐形占位，保持 tab 位置不偏移 */}
      <div className="px-3 pb-5 pt-2" style={isGallery ? { visibility: 'hidden' } : undefined}>
        <Logo size={18} />
      </div>

      {/* Search trigger — gallery 沉浸模式隐形占位 */}
      <button
        className="sidebar-search mx-2 mb-2.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-base"
        style={{
          background: 'var(--shelf)',
          color: 'var(--ink-ghost)',
          fontFamily: 'var(--font-sans)',
          ...(isGallery ? { visibility: 'hidden' } as const : {}),
        }}
        onClick={() => setSearchOpen(true)}
      >
        <Search size={13} strokeWidth={2} style={{ opacity: 0.4, color: 'var(--ink)' }} />
        <span>搜索</span>
        <kbd className="ml-auto text-sm" style={{ opacity: 0.45, color: 'var(--ink-ghost)' }}>⌘K</kbd>
      </button>

      <SearchPanel open={searchOpen} onOpenChange={setSearchOpen} />

      {/* Main navigation — 始终显示所有 tab */}
      <nav className="flex flex-col gap-0.5 px-2">
        {spaces.map((space) => (
          <div
            key={space}
            className="nav-item relative flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors duration-150"
            onClick={() => handleNavigate(space)}
          >
            {space === active && (
              <motion.span
                className="absolute inset-0 rounded-lg"
                style={{ background: 'var(--shelf)' }}
                layoutId="nav-active"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <span
              className="relative z-[1] flex items-center transition-colors duration-200"
              style={{ color: space === active ? 'var(--accent)' : 'var(--ink-faded)' }}
            >
              {(() => { const Icon = NavIcons[space]; return <Icon size={16} strokeWidth={1.5} />; })()}
            </span>
            <span
              className="relative z-[1] text-base transition-colors duration-200"
              style={{
                color: space === active ? 'var(--ink)' : 'var(--ink-faded)',
                fontWeight: space === active ? 500 : 400,
              }}
            >
              {labels[space]}
            </span>
          </div>
        ))}
      </nav>

      {/* Sub-nav: Notes — tree drill-down, fetches per level */}
      {active === 'notes' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="my-3" />

          {/* 面包屑导航 — 单行返回路径模式
           *  根层级：section 标题样式，无箭头
           *  有层级：← 箭头回退一级 + 路径段可点击
           *  超长时 hover … 弹出完整路径 */}
          <div className="mt-3 px-5 pb-2">
            {breadcrumb.length === 0 ? (
              /* 根层级 — 纯标题，不可点击 */
              <span
                className="text-2xs font-semibold uppercase"
                style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
              >
                文稿
              </span>
            ) : (
              /* 钻入态分工(与 anthology 同款语义):
                   ←        = 回上一级(根 / 上层 folder)
                   父级名块 = 进父级正文(FolderReader, /note?at=<父>);当前已在父级正文时 active 高亮
                   2+ 级时中间用 HoverCard 弹完整路径 */
              <div className="flex items-center whitespace-nowrap">
                {/* ← 回上一级:1 级回根、2+ 级回上一层 */}
                <span
                  className="shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-150 hover:bg-[var(--shelf)]"
                  style={{ color: 'var(--ink-faded)' }}
                  onClick={() =>
                    breadcrumb.length >= 2
                      ? goToBreadcrumb(breadcrumb.length - 2)
                      : goToBreadcrumb(null)
                  }
                >
                  <ChevronLeft size={14} strokeWidth={2} />
                </span>
                <div className="flex min-w-0 items-center">
                  {breadcrumb.length === 1 ? (
                    /* 1 级:父级名块,可点进 FolderReader 看正文,!noteId 时整块 active */
                    <span
                      className="max-w-[120px] cursor-pointer truncate rounded px-1 py-0.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                      style={{
                        background: !activeNoteId ? 'var(--shelf)' : undefined,
                        color: !activeNoteId ? 'var(--ink)' : 'var(--ink-light)',
                        fontWeight: !activeNoteId ? 500 : 400,
                      }}
                      title={breadcrumb[0].name}
                      onClick={() => navigate(`/note?at=${breadcrumb[0].id}`)}
                    >
                      {breadcrumb[0].name}
                    </span>
                  ) : (
                    /* 2+ 级: … / 末段名;末段同款"父级正文入口"语义 */
                    <>
                      <HoverCard openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          <span
                            className="cursor-pointer rounded px-1 py-0.5 text-xs transition-colors duration-150"
                            style={{ color: 'var(--ink-ghost)' }}
                          >
                            …
                          </span>
                        </HoverCardTrigger>
                        <HoverCardContent
                          align="start"
                          sideOffset={4}
                          className="w-auto min-w-[140px] max-w-[200px] rounded-lg border-none p-1.5"
                          style={{
                            background: 'var(--sidebar-bg)',
                            boxShadow: 'var(--shadow-sm)',
                          }}
                        >
                          <div
                            className="cursor-pointer truncate rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                            style={{ color: 'var(--ink-light)' }}
                            onClick={() => goToBreadcrumb(null)}
                          >
                            文稿
                          </div>
                          {breadcrumb.slice(0, -1).map((item, i) => (
                            <div
                              key={item.id}
                              className="cursor-pointer truncate rounded-lg py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                              style={{
                                color: 'var(--ink-light)',
                                paddingLeft: `${(i + 1) * 10 + 10}px`,
                                paddingRight: 10,
                              }}
                              onClick={() => goToBreadcrumb(i)}
                            >
                              {item.name}
                            </div>
                          ))}
                        </HoverCardContent>
                      </HoverCard>
                      <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>/</span>
                      <span
                        className="max-w-[100px] cursor-pointer truncate rounded px-1 py-0.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                        style={{
                          background: !activeNoteId ? 'var(--shelf)' : undefined,
                          color: !activeNoteId ? 'var(--ink)' : 'var(--ink-light)',
                          fontWeight: !activeNoteId ? 500 : 400,
                        }}
                        title={breadcrumb[breadcrumb.length - 1].name}
                        onClick={() => navigate(`/note?at=${breadcrumb[breadcrumb.length - 1].id}`)}
                      >
                        {breadcrumb[breadcrumb.length - 1].name}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {notesLoading ? (
            <LoadingState variant="inline" />
          ) : currentNodes.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-6">
              <FileText size={20} strokeWidth={1.2} style={{ color: 'var(--ink-ghost)', opacity: 0.4 }} />
              <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>还没有内容</span>
            </div>
          ) : (
            <div className="px-2.5">
              <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={currentParentId || 'root'}
                initial={{ opacity: 0, x: navEnterX }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: navExitX }}
                transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
                /* space-y-px 给项与项之间 1px 间隙,避免相邻 active/hover 背景块粘连;
                   保持设计语言要求的"高密度紧凑感",仅为分隔不为留白 */
                className="space-y-px"
              >
                {/* page tree 心智:节点不分 FOLDER/DOC,统一渲染为「页面」。
                    - FOLDER 点击:enterFolder 钻入下一层(改 ?at,FolderReader 接管渲染 folder 自身正文)
                    - DOC   点击:跳 /note?at=&node=,NoteReader 渲染叶子正文
                    高亮规则:DOC 用 contentItemId 与 URL ?node 匹配 active;FOLDER 无 active 态 */}
                {currentNodes.map((node) => {
                  const isActive =
                    !!node.contentItemId && activeNoteId === node.contentItemId;
                  return (
                    <div
                      key={node.id}
                      className="hover-shelf flex cursor-pointer items-center rounded-lg px-3 py-1.5 transition-all duration-150"
                      style={{ background: isActive ? 'var(--shelf)' : undefined }}
                      onClick={() => {
                        if (node.type === 'FOLDER') {
                          enterFolder(node);
                        } else if (node.contentItemId) {
                          navigate(
                            currentParentId
                              ? `/note?at=${currentParentId}&node=${node.contentItemId}`
                              : `/note?node=${node.contentItemId}`,
                          );
                        }
                      }}
                    >
                      <span
                        className="truncate text-base"
                        style={{
                          color: isActive ? 'var(--ink)' : 'var(--ink-light)',
                          fontWeight: isActive ? 500 : 400,
                        }}
                      >
                        {node.name}
                      </span>
                    </div>
                  );
                })}
              </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* Sub-nav: Anthology — 镜像笔记钻入式 sub-nav
        *   根:文集列表(像笔记根级)
        *   钻入:← 文集 面包屑 + 该文集的篇章列表 + 当前篇高亮 */}
      {active === 'anthology' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="my-3" />

          {/* 面包屑 — 钻入态分工:
                ←        = 回上一级(根)
                父级名块 = 进父级正文(Overview);当前已在父级正文时高亮 var(--shelf) 背景
              「父级正文」语义:文集自身的卷首语正文页(/anthology?node=cixxx),
                跟「篇章正文页」并列,都是 page tree 上的节点 */}
          <div className="mt-3 px-5 pb-2">
            {!anthologyContainerId ? (
              /* 根态:section 标题 */
              <span
                className="text-2xs font-semibold uppercase"
                style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
              >
                文集
              </span>
            ) : (
              <div className="flex items-center whitespace-nowrap">
                {/* ← 回上一级(目前永远回根,因文集只 1 级钻入) */}
                <span
                  className="shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-150 hover:bg-[var(--shelf)]"
                  style={{ color: 'var(--ink-faded)' }}
                  onClick={() => navigate('/anthology')}
                >
                  <ChevronLeft size={14} strokeWidth={2} />
                </span>
                {/* 父级名块:点击 = 进父级正文(Overview);Overview 态时整块 active 高亮 */}
                <div className="flex min-w-0 items-center">
                  <span
                    className="max-w-[120px] cursor-pointer truncate rounded px-1 py-0.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                    style={{
                      /* anthologyActiveEntry 为 null 表示 URL 无 ?at=,正在看父级正文(Overview) */
                      background: !anthologyActiveEntry ? 'var(--shelf)' : undefined,
                      color: !anthologyActiveEntry ? 'var(--ink)' : 'var(--ink-light)',
                      fontWeight: !anthologyActiveEntry ? 500 : 400,
                    }}
                    title={anthologyContainerTitle ?? ''}
                    onClick={() => navigate(`/anthology?node=${anthologyContainerId}`)}
                  >
                    {anthologyContainerTitle ?? ''}
                  </span>
                </div>
              </div>
            )}
          </div>

          {anthologyLoading ? (
            <LoadingState variant="inline" />
          ) : anthologyItems.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-3 py-6">
              <FileText size={20} strokeWidth={1.2} style={{ color: 'var(--ink-ghost)', opacity: 0.4 }} />
              <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>还没有内容</span>
            </div>
          ) : (
            <div className="px-2.5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={anthologyContainerId || 'root'}
                  initial={{ opacity: 0, x: navEnterX }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: navExitX }}
                  transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
                  /* 同 notes:1px 微间距,避免相邻 active/hover 背景块粘连 */
                  className="space-y-px"
                >
                  {anthologyItems.map((item) => {
                    const isActive =
                      !!anthologyContainerId &&
                      anthologyActiveEntry === item.nodeId;
                    /* 根态:点击 = 进文集 Overview;钻入态:点击 = 进 EntryReader */
                    const target = anthologyContainerId
                      ? `/anthology?at=${anthologyContainerId}&node=${item.nodeId}`
                      : `/anthology?node=${item.nodeId}`;
                    return (
                      <div
                        key={item.nodeId}
                        className="hover-shelf flex cursor-pointer items-center rounded-lg px-3 py-1.5 transition-all duration-150"
                        style={{ background: isActive ? 'var(--shelf)' : undefined }}
                        onClick={() => navigate(target)}
                      >
                        <span
                          className="truncate text-base"
                          style={{
                            color: isActive ? 'var(--ink)' : 'var(--ink-light)',
                            fontWeight: isActive ? 500 : 400,
                          }}
                        >
                          {item.title}
                        </span>
                      </div>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* Gallery 页面是全屏沉浸式，侧边栏不需要额外内容 */}

      {/* Bottom — ambient phrase（gallery 沉浸模式隐形占位，保持 sidebar 高度一致） */}
      <div className="mt-auto px-3 py-4" style={isGallery ? { visibility: 'hidden' } : undefined}>
        <span
          className="text-xs leading-relaxed"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '-0.01em' }}
        >
          {getAmbientPhrase()}
        </span>
      </div>
    </aside>
  );
}
