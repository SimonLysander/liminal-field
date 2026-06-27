/*
 * LearnView — 学习视图。路由 /admin/notes/:id/learn(?node=<chapterId>)。
 *
 * 锁定的「对照重写双栏」:左 = AI 那份(只读) | 右 = 我的(可编辑) + 点 ✦ 聚焦态(三拍动效)。
 * 双栏骨架/宽度/三拍一律不动。两件事各占一边、互不侵犯:
 *   - 左栏 = Aurora 的:总章→规划产出(理解+脉络提案,只读参考);篇→AI 初稿。
 *   - 右栏 = 我的:顶部嵌一块【我的篇目】目录(建/改名/拖排序/删/进入)= 外面那棵真笔记树,双向同步。
 *
 * ── 动作语义(2026-06 定):模型只产【规划提案】+【草稿】,绝不碰结构。──
 * 「新建」「改名」「排序」「删」全是我按的;提案在左只读、纯参考,建篇在右边自己来。
 * 序 = 我自己的篇目序(可拖),篇内 ←/→ 跟它走。
 *
 * ⚠️ 数据是样例(花卉);真功能见 docs/agent/learning-build-spec.md;文风/范本是提示词的事,最后定。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, ChevronDown, Circle, Check, Plus,
  GripVertical, Pencil, X, Sun, Moon, Sparkles, MoreHorizontal,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { AdvisorSidebar } from '@/components/ai-advisor/AdvisorSidebar';
import { DraftAssetProvider } from '@/contexts/DraftAssetContext';
import { useTheme } from '@/hooks/use-theme';
import {
  createChatMessageAttachment,
  type ChatSelectionAttachment,
} from '@/pages/admin/lib/live-chat-selection';
import { PlateMarkdownEditor } from '../components/PlateEditor';

// ─── 样例:主题(总章)+ AI 规划产出(有序脉络提案) ─────────────────────────────

const ROOT = 'flower';

const TOPIC = {
  title: '花卉',
  goal: '系统认识花卉,偏园艺养护,能从原理上看懂怎么养',
  understanding: `认识一种花,可以先立一个锚:花是植物的繁殖器官。它的形态、花期,乃至养护上的种种讲究,追究到底都服务于同一件事,即把基因传下去。锚一旦立住,该学什么、以什么次序学,便能顺着因果推演出来。

这条线从目的起步:先弄清花为何而开。再看构造如何服务这一目的;构造要运转,须往下追问能量与水分的供给和流转。内部讲透之后,转向植株与环境的相互作用;最后把这些原理落到具体的养护上。养护并非另起炉灶,而是前面推演的兑现,故置于终点。`,
};

interface PlanItem {
  key: string;
  title: string;
  thread: string; // 脉络词(这一步的主题)
  note: string;   // 为何写这一章
}

// AI 规划产出:有序的脉络提案(只读,可改的建议,不是钉死目录)。
const PLAN: PlanItem[] = [
  { key: 'c1', title: '花为什么开', thread: '目的', note: '开放即繁殖。先确立"花为何而开"这一目的,作为整条线的根。' },
  { key: 'c2', title: '花的结构与功能', thread: '构造', note: '花的各个部件,如何分工服务于传粉与受精这一目的。' },
  { key: 'c3', title: '光合与养分', thread: '供给', note: '构造要运转,需先追问能量来自何处。' },
  { key: 'c4', title: '水分与蒸腾', thread: '供给', note: '继而追问水分如何吸收、输运与散失。' },
  { key: 'c5', title: '环境与适应', thread: '环境', note: '内部机制讲透后,转向植株与外部环境的相互作用。' },
  { key: 'c6', title: '养护的原理', thread: '实践', note: '将前述原理落到养护实践,是整条线的兑现。' },
];

const C1_DRAFT = `## 花为什么开

花不是为了好看才开 —— 它是植物的**繁殖器官**,开放这件事,本质是植物把"求偶广告"挂出来。

颜色、气味、形状,追到底都在回答一个问题:**怎么把花粉送出去、把别人的花粉接进来**。靠虫的,就得鲜艳、有蜜、有味;靠风的,索性放弃颜色,把花药挂得高高的随风扬。

> 所以"花为什么长这样"永远先问"它靠谁传粉"——目的决定形态,这就是整条线的锚。`;

const C1_MYDRAFT = `## 花为什么开

花是植物的繁殖器官。开花,就是把传粉这件事摆上台面。

我自己的理解:形态服务于传粉方式。靠虫传粉的,得在颜色、气味、蜜上下功夫,把昆虫招来;靠风的,反而省掉这些,把花药举高,交给风。

所以看一朵花长什么样,先别急着记名字,先问它靠谁传粉——这一问,形态上的讲究大半就解释通了。`;

// ─── 我的篇目(我亲手建的真节点,可改名/排序/删;采纳自提案的记 fromKey) ──────────

interface MyChapter {
  id: string;
  title: string;
  fromKey?: string; // 采纳自哪条提案(仅用于左栏标"已采纳");其余一切以本条为准
  aiDraft: string;
  myDraft: string;
}

/** 篇的 AI 初稿样例(演示「草稿产出」)。采纳自 c1 的用精修稿,其余用占位稿。 */
function sampleDraft(ch: MyChapter): string {
  if (ch.fromKey === 'c1') return C1_DRAFT;
  return `## ${ch.title}

(Aurora 研究稿示例)这一段是 Aurora 联网研究、核实出处后产出的初稿。正式的行文逻辑与文风由提示词决定,这里只演示「草稿产出」落到左栏、你在右栏对照重写的过程。`;
}

// 样例初值:c1 已学(✓)、c2 有稿待重写(◐)、c3 已建待研究(●);c4-c6 还在提案里没采纳。
const INITIAL_CHAPTERS: MyChapter[] = [
  { id: 'c1', title: '花为什么开', fromKey: 'c1', aiDraft: C1_DRAFT, myDraft: C1_MYDRAFT },
  { id: 'c2', title: '花的结构与功能', fromKey: 'c2', aiDraft: `## 花的结构与功能\n\n(Aurora 研究稿示例)花由花萼、花瓣、雄蕊、雌蕊四轮自外向内排布,各轮的存废与形态,都能回到"如何把传粉这件事办成"这一目的上解释。\n\n这一段是 Aurora 研究后产出的初稿,你在右栏对照着把它重写成自己的版本。`, myDraft: '' },
  { id: 'c3', title: '光合与养分', fromKey: 'c3', aiDraft: '', myDraft: '' },
];

const FADE_MS = 300;
const SLIDE_MS = 650;

// ─── 小件 ─────────────────────────────────────────────────────────────────────

/** **粗体** → <strong> 的极简 prose。 */
function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split('\n\n').map((para, pi) => (
        <p key={pi} className="mb-3.5" style={{ color: 'var(--ink)' }}>
          {para.split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
            seg.startsWith('**') ? (
              <strong key={si} style={{ fontWeight: 600 }}>{seg.slice(2, -2)}</strong>
            ) : (
              <span key={si}>{seg}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
}

// ─── 左栏:Aurora 的规划提案(只读,可「采纳→」) ─────────────────────────────────

function PlanProduct() {
  return (
    <div className="mx-auto w-full max-w-[38rem] px-8 pb-20 pt-6">
      {/* 目标 */}
      <div className="mb-5 flex items-baseline gap-2.5 pb-4" style={{ borderBottom: '1px solid var(--separator)' }}>
        <span className="shrink-0 text-2xs uppercase" style={{ color: 'var(--ink-faded)', letterSpacing: '0.06em' }}>这次学</span>
        <span className="text-md" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>{TOPIC.goal}</span>
      </div>

      {/* 理解(自然段:Aurora 向我解释思路) */}
      <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-faded)' }}>
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' }} />
        <span><b style={{ color: 'var(--ink)' }}>Aurora 的理解</b> · 研究后</span>
      </div>
      <div className="text-md" style={{ fontFamily: 'var(--font-serif)', lineHeight: 'var(--leading-reading, 1.75)' }}>
        <Prose text={TOPIC.understanding} />
      </div>

      {/* 脉络(Aurora 的提案,只读参考;建篇在右边自己来,这里不放任何动作) */}
      <div className="mb-1 mt-7">
        <span className="text-2xs uppercase" style={{ color: 'var(--ink-faded)', letterSpacing: '0.06em' }}>脉络 · 提案</span>
      </div>
      <div className="relative">
        <span className="absolute left-[60px] top-[18px] bottom-6 w-px" style={{ background: 'var(--separator)' }} />
        {PLAN.map((p, i) => {
          const prevThread = i > 0 ? PLAN[i - 1].thread : undefined;
          const showThread = p.thread !== prevThread;
          return (
            <div key={p.key} className="grid w-full items-start py-2.5" style={{ gridTemplateColumns: '48px 24px 1fr' }}>
              <div className="flex justify-end pr-2 pt-[3px] text-2xs" style={{ color: showThread ? 'var(--ink-faded)' : 'transparent', letterSpacing: '0.04em' }}>{p.thread}</div>
              <div className="relative flex justify-center pt-[7px]">
                <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 0 4px var(--paper)' }} />
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="tabular-nums text-xs" style={{ color: 'var(--ink-ghost)' }}>{i + 1}</span>
                  <span className="text-md" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>{p.title}</span>
                </div>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-faded)', lineHeight: 1.65 }}>{p.note}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 右栏顶部:嵌入式「我的篇目」目录(可折叠 + dnd 拖排序) ───────────────────────

function SortableChapterRow({
  ch, index, current, onNavigate, onRename, onRemove,
}: {
  ch: MyChapter;
  index: number;
  current: boolean;
  onNavigate: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ch.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ch.title);
  const studied = ch.aiDraft.trim().length > 0; // 研究过(有 AI 稿)= 学过;没学过的弱化成淡墨

  const startEdit = () => { setDraft(ch.title); setEditing(true); };
  const commit = () => { const t = draft.trim(); if (t && t !== ch.title) onRename(ch.id, t); setEditing(false); };

  // 纯结构编辑:拖排序 + 序号 + 标题(点进入 / 改名) + 删。不掺任何学习状态。
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, background: current ? 'var(--accent-soft)' : undefined }}
      className="group flex items-center gap-1.5 rounded-md py-1.5 pl-1 pr-1.5 transition-colors hover:bg-[var(--shelf)]"
    >
      {/* 拖拽柄(只挂柄,不挂整行) */}
      <button type="button" aria-label="拖拽排序" className="flex w-4 shrink-0 cursor-grab items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing" style={{ color: 'var(--ink-ghost)' }} {...attributes} {...listeners}>
        <GripVertical size={13} strokeWidth={1.5} />
      </button>
      <span className="w-4 shrink-0 text-right tabular-nums text-2xs" style={{ color: 'var(--ink-ghost)' }}>{index + 1}</span>

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="min-w-0 flex-1 rounded border-none bg-transparent px-1 py-0.5 text-sm outline-none"
          style={{ color: 'var(--ink)', boxShadow: '0 0 0 1px var(--accent)' }}
        />
      ) : (
        <button onClick={() => onNavigate(ch.id)} className="min-w-0 flex-1 truncate text-left text-sm outline-none" style={{ color: studied ? 'var(--ink)' : 'var(--ink-faded)' }} title="进入这一篇">
          {ch.title}
        </button>
      )}

      {/* 悬停动作:改名 / 删 */}
      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={startEdit} className="rounded p-1 outline-none hover:bg-[var(--paper)]" style={{ color: 'var(--ink-ghost)' }} title="改名"><Pencil size={12} strokeWidth={1.6} /></button>
          <button onClick={() => onRemove(ch.id)} className="rounded p-1 outline-none hover:bg-[var(--paper)]" style={{ color: 'var(--ink-ghost)' }} title="删除这一篇"><X size={12} strokeWidth={1.8} /></button>
        </div>
      )}
    </div>
  );
}

function ChapterOutline({
  chapters, currentId, isTopic, onNavigate, onAdd, onRename, onRemove, onReorder,
}: {
  chapters: MyChapter[];
  currentId: string;
  isTopic: boolean;
  onNavigate: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}) {
  // 总章默认展开(规划重心);叶子默认收成一行穿梭器,不挤占写字。
  const [open, setOpen] = useState(isTopic);
  const currentIdx = chapters.findIndex((c) => c.id === currentId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) onReorder(String(active.id), String(over.id));
  };

  return (
    <div className="mb-5 pb-3" style={{ borderBottom: '1px solid var(--separator)' }}>
      {/* 目录头(点开/收起) */}
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-md py-0.5 pr-1 outline-none" style={{ color: 'var(--ink-faded)' }}>
          {open ? <ChevronDown size={13} strokeWidth={1.8} /> : <ChevronRight size={13} strokeWidth={1.8} />}
          <span className="text-2xs uppercase" style={{ letterSpacing: '0.06em' }}>
            我的篇目{isTopic ? ` · ${chapters.length} 篇` : currentIdx >= 0 ? ` · 第 ${currentIdx + 1}/${chapters.length} 篇` : ''}
          </span>
        </button>
        {open && (
          <button onClick={onAdd} className="ml-auto flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs outline-none transition-colors hover:bg-[var(--shelf)]" style={{ color: 'var(--ink-faded)' }} title="凭空新建一篇(不经提案)">
            <Plus size={11} strokeWidth={2} /> 新建一篇
          </button>
        )}
      </div>

      {/* 目录体 */}
      {open && (
        chapters.length === 0 ? (
          <p className="px-1 py-3 text-xs" style={{ color: 'var(--ink-ghost)' }}>从左边脉络「采纳」,或「新建一篇」,搭起你的篇目。</p>
        ) : (
          <div className="mt-1.5">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={chapters.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {chapters.map((c, i) => (
                  <SortableChapterRow key={c.id} ch={c} index={i} current={c.id === currentId} onNavigate={onNavigate} onRename={onRename} onRemove={onRemove} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )
      )}
    </div>
  );
}

function EditControls() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <button className="rounded-md px-2.5 py-1 text-sm outline-none transition-colors hover:bg-[var(--shelf)]" style={{ color: 'var(--ink-faded)' }} title="保存草稿(原型未接)">保存</button>
      <button className="rounded-md px-3 py-1 text-sm outline-none transition-colors" style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }} title="提交版本(原型未接)">提交</button>
      <button
        className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)]"
        style={{ color: 'var(--ink-ghost)' }}
        onClick={() => setTheme(theme === 'midnight' ? 'daylight' : 'midnight')}
        title="切换主题"
        aria-label="切换主题"
      >
        {theme === 'midnight' ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
      </button>
      <button className="rounded-md p-1.5 outline-none transition-colors hover:bg-[var(--shelf)]" style={{ color: 'var(--ink-ghost)' }} title="更多" aria-label="更多">
        <MoreHorizontal size={16} strokeWidth={1.5} />
      </button>
    </>
  );
}

// ─── 节点屏(对照重写双栏;左 AI 那份 / 右 我的[篇目目录 + 正文重写]) ───────────────

function NodeScreen({
  nodeId, chapters, onNavigate, onAdd, onRename, onRemove, onReorder, onDraft,
}: {
  nodeId: string;
  chapters: MyChapter[];
  onNavigate: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, title: string) => void;
  onRemove: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
  onDraft: (id: string) => void;
}) {
  const navigate = useNavigate();
  const isTopic = nodeId === ROOT;
  const idx = isTopic ? -1 : chapters.findIndex((c) => c.id === nodeId);
  const chapter = idx >= 0 ? chapters[idx] : null;
  const prev = idx > 0 ? chapters[idx - 1].id : null;
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1].id : null;

  const aiDraft = chapter?.aiDraft ?? '';
  const myDraft = chapter?.myDraft ?? '';
  const studied = aiDraft.trim().length > 0;
  const title = isTopic ? TOPIC.title : chapter?.title ?? '';

  // 总章 CTA「继续学习」:跳到第一个还没重写完的篇,没有则末篇。
  // 继续学习:跳到顺序上最新的已研究篇(有 AI 稿的最后一篇 = 当前进度);都没研究过则落第一篇。
  const anyResearched = chapters.some((c) => c.aiDraft.trim().length > 0);
  const resume = [...chapters].reverse().find((c) => c.aiDraft.trim().length > 0) ?? chapters[0] ?? null;

  const [auroraOpen, setAuroraOpen] = useState(false);
  const [slid, setSlid] = useState(false);
  const [rewriteVisible, setRewriteVisible] = useState(true);
  const [auroraVisible, setAuroraVisible] = useState(false);
  const [selections, setSelections] = useState<ChatSelectionAttachment[]>([]);
  const [pending, setPending] = useState<{ text: string; x: number; y: number } | null>(null);

  const draftScrollRef = useRef<HTMLDivElement>(null);
  const rewriteScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timers: number[] = [];
    if (auroraOpen) {
      queueMicrotask(() => setRewriteVisible(false));
      timers.push(window.setTimeout(() => setSlid(true), FADE_MS));
      timers.push(window.setTimeout(() => setAuroraVisible(true), FADE_MS + SLIDE_MS));
    } else {
      queueMicrotask(() => setAuroraVisible(false));
      timers.push(window.setTimeout(() => setSlid(false), FADE_MS));
      timers.push(window.setTimeout(() => setRewriteVisible(true), FADE_MS + SLIDE_MS));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [auroraOpen]);

  const handleDraftMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text || !sel || sel.rangeCount === 0) {
      setPending(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setPending({ text, x: rect.left + rect.width / 2, y: rect.top });
  };
  const addSelectionToAurora = () => {
    if (!pending) return;
    setSelections((prev2) => [...prev2, createChatMessageAttachment({ text: pending.text })]);
    setAuroraOpen(true);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };
  const removeSelection = (id: string) =>
    setSelections((prev2) => prev2.filter((a) => (a.id === id ? (a.dispose(), false) : true)));
  const clearSelections = () => setSelections((prev2) => (prev2.forEach((a) => a.dispose()), []));

  const navBtn = (icon: ReactNode, onClick: (() => void) | null, label?: string, title2?: string) => (
    <button
      className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-[var(--shelf)] disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
      style={{ color: 'var(--ink-faded)' }}
      onClick={onClick ?? undefined}
      disabled={!onClick}
      title={title2}
    >
      {icon}
      {label && <span className="text-sm">{label}</span>}
    </button>
  );

  const outline = (
    <ChapterOutline
      chapters={chapters}
      currentId={nodeId}
      isTopic={isTopic}
      onNavigate={onNavigate}
      onAdd={onAdd}
      onRename={onRename}
      onRemove={onRemove}
      onReorder={onReorder}
    />
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'var(--paper)' }}>
      {/* 顶栏 */}
      <header className="flex h-[48px] shrink-0 items-center gap-2 px-4">
        {isTopic ? (
          <>
            {navBtn(<ChevronLeft size={18} strokeWidth={1.5} />, () => navigate('/admin/notes'), undefined, '退出学习')}
            <span className="text-sm font-medium" style={{ color: 'var(--ink-faded)' }}>{title}</span>
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>规划中</span>
          </>
        ) : (
          <>
            {/* 叶子页左侧只留章节切换器;回主题挪到右侧做成与「继续学习」对称的主操作 pill */}
            {navBtn(<ChevronLeft size={17} strokeWidth={1.5} />, prev ? () => onNavigate(prev) : null, undefined, '上一篇')}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium outline-none transition-colors hover:bg-[var(--shelf)]" style={{ color: 'var(--ink-faded)' }} title="跳到任意篇">
                  {title}
                  <ChevronDown size={14} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[60vh] min-w-[13rem] overflow-y-auto">
                {chapters.map((c, i) => (
                  <DropdownMenuItem key={c.id} onClick={() => onNavigate(c.id)} className="gap-2 text-sm">
                    <span className="w-4 shrink-0 text-right tabular-nums text-2xs" style={{ color: 'var(--ink-ghost)' }}>{i + 1}</span>
                    <span className="flex-1 truncate" style={{ color: c.id === nodeId ? 'var(--accent)' : 'var(--ink)' }}>{c.title}</span>
                    {c.id === nodeId && <Check size={13} strokeWidth={2} style={{ color: 'var(--accent)' }} />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {navBtn(<ChevronRight size={17} strokeWidth={1.5} />, next ? () => onNavigate(next) : null, undefined, '下一篇')}
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {isTopic && resume && (
            <>
              {/* 淡底 pill,与「返回主题」同分量;标签用篇名而非"第N篇"计数 */}
              <button
                onClick={() => onNavigate(resume.id)}
                className="flex items-center gap-1 rounded-md px-3.5 py-1.5 text-sm font-medium outline-none transition-opacity hover:opacity-80"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                title={`${anyResearched ? '继续学习' : '开始学习'} · ${resume.title}`}
              >
                <span className="min-w-0 max-w-[15rem] truncate">{anyResearched ? '继续学习' : '开始学习'} · {resume.title}</span>
                <ChevronRight size={15} strokeWidth={2} className="shrink-0" />
              </button>
              <span className="mx-1 h-4 w-px" style={{ background: 'var(--separator)' }} />
            </>
          )}
          {/* 叶子页主操作:返回主题(规划页),与规划页「继续学习」同样式、同位置,互为正反 */}
          {!isTopic && (
            <>
              {/* 淡底:返回是导航不是主任务,降一档分量,不跟正文抢眼;与「继续学习」同色系不同分量 */}
              <button
                onClick={() => onNavigate(ROOT)}
                className="flex items-center gap-1 rounded-md px-3.5 py-1.5 text-sm font-medium outline-none transition-opacity hover:opacity-80"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <ChevronLeft size={15} strokeWidth={2} /> 返回主题
              </button>
              <span className="mx-1 h-4 w-px" style={{ background: 'var(--separator)' }} />
            </>
          )}
          <button
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors hover:bg-[var(--shelf)]"
            style={{ color: auroraOpen ? 'var(--accent)' : 'var(--ink-faded)' }}
            onClick={() => setAuroraOpen((v) => !v)}
            title="唤出 / 收起 Aurora"
            aria-pressed={auroraOpen}
          >
            <Sparkles size={15} strokeWidth={1.5} />
            Aurora
          </button>
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--separator)' }} />
          <EditControls />
        </div>
      </header>

      {/* 对照重写双栏 */}
      <div className="flex min-h-0 flex-1">
        {/* 左:AI 那份(总章=规划提案;篇=AI 初稿) */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ minWidth: 0, background: 'color-mix(in srgb, var(--paper) 82%, var(--shelf))', borderRight: '1px solid var(--separator)' }}
          onMouseUp={!isTopic && studied ? handleDraftMouseUp : undefined}
        >
          <div ref={draftScrollRef} className="h-full overflow-y-auto">
            {isTopic ? (
              <PlanProduct />
            ) : studied ? (
              <div className="mx-auto w-full max-w-[var(--layout-editor-max)] pb-24 pt-2">
                <DraftAssetProvider contentItemId={`learn-${nodeId}`}>
                  <PlateMarkdownEditor key={`d-${nodeId}`} initialMarkdown={aiDraft} readOnly />
                </DraftAssetProvider>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
                <Circle size={20} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
                <div className="space-y-1.5">
                  <p className="text-md font-light" style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}>这一篇还没研究</p>
                  <p className="text-sm" style={{ color: 'var(--ink-faded)' }}>让 Aurora 联网研究、按文风起草,初稿会产在这一栏。</p>
                </div>
                <button
                  onClick={() => onDraft(nodeId)}
                  className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium outline-none transition-colors"
                  style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
                >
                  <Sparkles size={14} strokeWidth={1.8} /> 让 Aurora 起草这一篇
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右:我的(顶部嵌篇目目录 + 正文重写) */}
        <div
          className="relative min-h-0 shrink-0 overflow-hidden"
          style={{ background: 'var(--paper)', width: slid ? 0 : '50%', transition: `width ${SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)` }}
        >
          <div ref={rewriteScrollRef} className="h-full overflow-y-auto" style={{ opacity: rewriteVisible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}>
            {/* 目录只活在规划页;叶子页 = 纯对照重写,顶上不挂任何东西(换篇靠顶栏 ←/→/↑) */}
            <div className={`mx-auto w-full max-w-[var(--layout-editor-max)] pb-40 ${isTopic ? 'px-2 pt-4' : 'pt-2'}`}>
              {isTopic && outline}
              <DraftAssetProvider contentItemId={`learn-${nodeId}`}>
                <PlateMarkdownEditor key={`r-${nodeId}`} initialMarkdown={myDraft} onChange={() => {}} />
              </DraftAssetProvider>
            </div>
          </div>
        </div>

        {/* Aurora */}
        <div
          className="min-h-0 shrink-0 overflow-hidden"
          style={{ background: 'var(--paper)', width: slid ? 'clamp(340px, 26vw, 420px)' : 0, transition: `width ${SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)` }}
        >
          <div className="h-full" style={{ opacity: auroraVisible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}>
            <AdvisorSidebar
              key={`a-${nodeId}`}
              sessionKey={`learn-${nodeId}`}
              agentKey={isTopic ? 'learning-planner' : 'writing-advisor'}
              source={isTopic ? 'learning-editor' : 'notes-editor'}
              // learningTopicId 替代已删除的 learningProjectId，绑定规划写入目标节点
              context={isTopic ? { learningTopicId: nodeId } : { document: { contentItemId: `learn-${nodeId}` } }}
              greeting={isTopic ? '想怎么调这份理解 / 脉络?' : studied ? '想改这篇初稿的哪里?' : '这一篇要研究什么?我来起草。'}
              selectionAttachments={selections}
              onRemoveSelectionAttachment={removeSelection}
              onClearSelectedText={clearSelections}
              onClose={() => setAuroraOpen(false)}
            />
          </div>
        </div>
      </div>

      {pending && (
        <button
          className="fixed z-50 flex items-center gap-1 rounded-md px-2.5 py-1 text-xs shadow-md"
          style={{ left: pending.x, top: pending.y - 38, transform: 'translateX(-50%)', background: 'var(--accent)', color: 'var(--accent-contrast)' }}
          onClick={addSelectionToAurora}
        >
          <Sparkles size={12} strokeWidth={1.8} />
          加入 Aurora
        </button>
      )}
    </div>
  );
}

// ─── 根 ───────────────────────────────────────────────────────────────────────

export default function LearnView() {
  const [searchParams, setSearchParams] = useSearchParams();
  // 我的篇目(真结构,软连提案)。采纳/新建/改名/排序/删/起草都改这里,在父层存活不随导航重挂而丢。
  const [chapters, setChapters] = useState<MyChapter[]>(INITIAL_CHAPTERS);
  const nextId = useRef(100);
  const gen = () => `n${nextId.current++}`;

  const param = searchParams.get('node');
  const nodeId = param && chapters.some((c) => c.id === param) ? param : ROOT; // 深链指向已删/未建篇 → 落回总章

  const onNavigate = (id: string) => setSearchParams(id === ROOT ? {} : { node: id });

  const onAdd = () => setChapters((cs) => [...cs, { id: gen(), title: '未命名', aiDraft: '', myDraft: '' }]);
  const onRename = (id: string, title: string) => setChapters((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
  const onRemove = (id: string) => {
    setChapters((cs) => cs.filter((c) => c.id !== id));
    if (param === id) setSearchParams({}); // 删的正是当前篇 → 回总章
  };
  const onReorder = (activeId: string, overId: string) =>
    setChapters((cs) => {
      const from = cs.findIndex((c) => c.id === activeId);
      const to = cs.findIndex((c) => c.id === overId);
      return from < 0 || to < 0 ? cs : arrayMove(cs, from, to);
    });
  // 让 Aurora 起草:草稿产出落进该篇 aiDraft(已有则不覆盖)。
  const onDraft = (id: string) =>
    setChapters((cs) => cs.map((c) => (c.id === id ? { ...c, aiDraft: c.aiDraft.trim() ? c.aiDraft : sampleDraft(c) } : c)));

  return (
    <NodeScreen
      key={nodeId}
      nodeId={nodeId}
      chapters={chapters}
      onNavigate={onNavigate}
      onAdd={onAdd}
      onRename={onRename}
      onRemove={onRemove}
      onReorder={onReorder}
      onDraft={onDraft}
    />
  );
}
