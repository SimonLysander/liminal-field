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

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { structureApi } from '@/services/structure';
import type { StructureNode } from '@/services/structure';
import {
  Home,
  FileText,
  Image,
  Sparkles,
  Search,
  Folder,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { LoadingState } from '@/components/LoadingState';

/* ---------- Data ---------- */

type Space = 'home' | 'notes' | 'gallery' | 'agent';
const spaces: Space[] = ['notes', 'gallery'];

const labels: Record<Space, string> = {
  home: '首页',
  notes: '笔记',
  gallery: '画廊',
  agent: '助手',
};

/* Lucide 统一配置 */
const NAV_ICON = { size: 16, strokeWidth: 1.5 } as const;

const icons: Record<Space, React.ReactNode> = {
  home: <Home {...NAV_ICON} />,
  notes: <FileText {...NAV_ICON} />,
  gallery: <Image {...NAV_ICON} />,
  agent: <Sparkles {...NAV_ICON} />,
};

/* Placeholder data for agent sub-nav */

const agentSessions = [
  { title: '写作模式分析', date: '今天', status: 'active' },
  { title: '文稿关联发现', date: '昨天', status: 'done' },
  { title: '本周创作总结', date: 'Apr 20', status: 'done' },
];

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

/* ---------- Path ↔ Space mapping ---------- */

function pathToSpace(pathname: string): Space {
  const seg = pathname.split('/')[1];
  if (seg === 'note') return 'notes';
  if (spaces.includes(seg as Space)) return seg as Space;
  return 'notes';
}

function spaceToPath(space: Space): string {
  if (space === 'notes') return '/note';
  return `/${space}`;
}

/* ---------- Notes tree navigation ---------- */

type BreadcrumbItem = { id: string; name: string };

function useStructureLevel(parentId: string | undefined) {
  const [nodes, setNodes] = useState<StructureNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const req = parentId
      ? structureApi.getChildren(parentId, { visibility: 'public' })
      : structureApi.getRootNodes({ visibility: 'public' });

    req
      .then((result) => { if (!cancelled) setNodes(result.children); })
      .catch(() => { if (!cancelled) setNodes([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [parentId]);

  return { nodes, loading };
}

/* ---------- Component ---------- */

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = pathToSpace(location.pathname);

  /* query params 直接读 topic / doc，无需 regex 解析 pathname */
  const [searchParams] = useSearchParams();
  const activeTopicId = searchParams.get('topic');
  const activeNoteId = searchParams.get('doc');


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
  const currentParentId = activeTopicId ?? undefined;
  const { nodes: currentNodes, loading: notesLoading } = useStructureLevel(currentParentId);

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
      }).catch(() => {});
    } else if (activeTopicId) {
      structureApi.getPathByNodeId(activeTopicId).then((path) => {
        if (cancelled) return;
        const folders = path
          .filter((n) => n.type === 'FOLDER')
          .map((n) => ({ id: n.id, name: n.name }));
        setBreadcrumb(folders);
      }).catch(() => {});
    } else {
      /* 回到根目录 /note：清空面包屑 */
      setBreadcrumb([]);
    }

    return () => { cancelled = true; };
  }, [activeNoteId, activeTopicId, active]);

  const handleNavigate = (space: Space) => {
    navigate(spaceToPath(space));
  };

  /* 进入文件夹：立即追加 breadcrumb（UI 即时反馈），URL 只写 topic */
  const enterFolder = (node: StructureNode) => {
    setBreadcrumb((prev) => [...prev, { id: node.id, name: node.name }]);
    navigate(`/note?topic=${node.id}`);
  };

  /* 面包屑回退：只改 URL，state 由 useEffect 同步 */
  const goToBreadcrumb = (index: number | null) => {
    if (index === null) {
      navigate('/note');
    } else {
      navigate(`/note?topic=${breadcrumb[index].id}`);
    }
  };

  return (
    <aside
      className="flex shrink-0 flex-col overflow-y-auto"
      style={{
        width: 200,
        background: 'var(--sidebar-bg)',
        margin: '12px 0 12px 12px',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        /* gallery 页的模糊背景是 fixed z-index:0，sidebar 需要在其上方 */
        position: 'relative',
        zIndex: 2,
      }}
    >
      {/* Header */}
      <div className="px-3 pb-5 pt-2">
        <span
          className="text-base font-bold"
          style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}
        >
          Liminal Field
        </span>
      </div>

      {/* Search trigger */}
      <button
        className="sidebar-search mx-2 mb-2.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-base transition-all duration-150"
        style={{
          background: 'var(--shelf)',
          color: 'var(--ink-ghost)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <Search size={13} strokeWidth={2} style={{ opacity: 0.4, color: 'var(--ink)' }} />
        <span>搜索</span>
        <kbd className="ml-auto text-sm" style={{ opacity: 0.45, color: 'var(--ink-ghost)' }}>⌘K</kbd>
      </button>

      {/* Main navigation */}
      <nav className="flex flex-col gap-0.5">
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
              {icons[space]}
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
          <div className="mx-3 my-2.5 h-px" style={{ background: 'var(--separator)' }} />

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
              /* 有层级 — ← 回退一级 + 路径显示
               * 1 级: ← 文稿
               * 2+ 级: ← … / 直接父级（hover … 弹出完整路径可点击） */
              <div className="flex items-center whitespace-nowrap">
                <span
                  className="shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-150"
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
                    /* 只有 1 级：显示 "文稿" 点击回根 */
                    <span
                      className="max-w-[120px] cursor-pointer truncate rounded px-1 py-0.5 text-xs transition-colors duration-150"
                      style={{ color: 'var(--ink-light)' }}
                      onClick={() => goToBreadcrumb(null)}
                    >
                      文稿
                    </span>
                  ) : (
                    /* 2+ 级：… / 直接父级名
                     * hover … 用 Radix HoverCard 弹出完整路径 */
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
                          className="w-auto min-w-[140px] max-w-[200px] border-none p-1.5"
                          style={{
                            background: 'var(--sidebar-bg)',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: 'var(--shadow-sm)',
                          }}
                        >
                          <div
                            className="flex cursor-pointer items-center gap-2 truncate rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                            style={{ color: 'var(--ink-light)' }}
                            onClick={() => goToBreadcrumb(null)}
                          >
                            <Folder size={13} strokeWidth={1.5} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
                            文稿
                          </div>
                          {breadcrumb.slice(0, -1).map((item, i) => (
                            <div
                              key={item.id}
                              className="flex cursor-pointer items-center gap-2 truncate rounded-lg py-1.5 text-xs transition-colors duration-150 hover:bg-[var(--shelf)]"
                              style={{
                                color: 'var(--ink-light)',
                                paddingLeft: `${(i + 1) * 10 + 10}px`,
                                paddingRight: 10,
                              }}
                              onClick={() => goToBreadcrumb(i)}
                            >
                              <Folder size={13} strokeWidth={1.5} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
                              {item.name}
                            </div>
                          ))}
                        </HoverCardContent>
                      </HoverCard>
                      <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>/</span>
                      <span
                        className="max-w-[100px] truncate text-xs"
                        style={{ color: 'var(--ink-light)' }}
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
            <LoadingState />
          ) : currentNodes.length === 0 ? (
            <div className="px-3 py-4 text-xs" style={{ color: 'var(--ink-ghost)' }}>空</div>
          ) : (
            <div className="px-2.5">
              <motion.div
                key={currentParentId || 'root'}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.12 }}
              >
                {currentNodes.map((node) =>
                  node.type === 'FOLDER' ? (
                    <div
                      key={node.id}
                      className="hover-shelf flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-all duration-150"
                      onClick={() => enterFolder(node)}
                    >
                      <Folder size={14} strokeWidth={1.5} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
                      <span className="truncate text-base" style={{ color: 'var(--ink-light)' }}>{node.name}</span>
                      {node.hasChildren && (
                        <ChevronRight size={12} strokeWidth={2} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
                      )}
                    </div>
                  ) : node.contentItemId ? (
                    <div
                      key={node.id}
                      className="hover-shelf flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 transition-all duration-150"
                      style={{ background: activeNoteId === node.contentItemId ? 'var(--shelf)' : undefined }}
                      onClick={() => navigate(
                        currentParentId
                          ? `/note?topic=${currentParentId}&doc=${node.contentItemId}`
                          : `/note?doc=${node.contentItemId}`,
                      )}
                    >
                      <FileText size={14} strokeWidth={1.5} className="shrink-0" style={{ color: activeNoteId === node.contentItemId ? 'var(--ink)' : 'var(--ink-ghost)' }} />
                      <span
                        className="truncate text-base"
                        style={{
                          color: activeNoteId === node.contentItemId ? 'var(--ink)' : 'var(--ink-light)',
                          fontWeight: activeNoteId === node.contentItemId ? 500 : 400,
                        }}
                      >
                        {node.name}
                      </span>
                    </div>
                  ) : null,
                )}
              </motion.div>
            </div>
          )}
        </div>
      )}

      {/* Gallery 页面是全屏沉浸式，侧边栏不需要额外内容 */}

      {/* Sub-nav: Agent — sessions (placeholder) */}
      {active === 'agent' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-3 my-2.5 h-px" style={{ background: 'var(--separator)' }} />
          <div
            className="px-3 pb-2 pt-1.5 text-2xs font-medium uppercase"
            style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
          >
            对话
          </div>
          {agentSessions.map((s, i) => (
            <div
              key={i}
              className="hover-shelf flex cursor-pointer items-center justify-between rounded-lg px-3 py-[7px] transition-colors duration-150"
              style={{ background: i === 0 ? 'var(--shelf)' : undefined }}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div
                  className="truncate text-base"
                  style={{
                    color: i === 0 ? 'var(--ink)' : 'var(--ink-light)',
                    fontWeight: i === 0 ? 500 : 400,
                  }}
                >
                  {s.title}
                </div>
                <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>{s.date}</div>
              </div>
              {s.status === 'active' && (
                /* pip-c（淡紫）作为"进行中"状态的细节语义标记，仅此一处使用 pip 色 */
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--pip-c)' }} />
              )}
            </div>
          ))}
          <div
            className="hover-shelf hover-ink-faded mt-1 cursor-pointer rounded-lg px-3 py-2 text-xs transition-all duration-150"
            style={{ color: 'var(--ink-ghost)' }}
          >
            + 新对话
          </div>
        </div>
      )}

      {/* Bottom — ambient phrase */}
      <div className="mt-auto px-3 py-4">
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
