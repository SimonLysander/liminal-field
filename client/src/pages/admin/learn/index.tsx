/*
 * LearnView — 学习视图。路由 /admin/notes/:id/learn(:id = 主题 NavigationNode id;?node=<contentItemId> = 当前篇)。
 *
 * 锁定的「对照重写双栏」:左 = AI 那份(只读) | 右 = 我的(可编辑) + 点 ✦ 聚焦态(三拍动效)。
 * 双栏骨架/宽度/三拍一律不动。两件事各占一边、互不侵犯:
 *   - 左栏 = Aurora 的:总章→规划产出(理解+脉络提案,只读参考);篇→AI 初稿(aidraft)。
 *   - 右栏 = 我的:顶部嵌【我的篇目】目录(= 外面那棵真 NavigationNode 树,双向同步),下接我的正文重写(draft)。
 *
 * 数据全走真后端(useLearningData):篇目=structureApi 真树、初稿/草稿=notesApi、规划提案=主题 aidraft 解析。
 * 模型只产【规划提案】+【草稿】(经 learning-planner / learning-writer agent),绝不碰结构;建/改名/排序/删全是用户按的。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, ChevronDown, Circle, Check, Plus,
  GripVertical, Pencil, X, Sun, Moon, Sparkles, MoreHorizontal, Loader2,
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
import { LoadingState } from '@/components/LoadingState';
import { useTheme } from '@/hooks/use-theme';
import { notesApi } from '@/services/workspace';
import {
  createChatMessageAttachment,
  type ChatSelectionAttachment,
} from '@/pages/admin/lib/live-chat-selection';
import { PlateMarkdownEditor } from '../components/PlateEditor';
import { useLearningData, type LearnPlan, type Chapter, type LearningData } from './useLearningData';

const FADE_MS = 300;
const SLIDE_MS = 650;
const AUTOSAVE_MS = 1200;

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

// ─── 左栏:Aurora 的规划提案(只读;没有则引导去规划)─────────────────────────────

function PlanProduct({ plan, onPlanWithAurora }: { plan: LearnPlan | null; onPlanWithAurora: () => void }) {
  if (!plan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <Circle size={20} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
        <div className="space-y-1.5">
          <p className="text-md font-light" style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--font-serif)' }}>还没有规划</p>
          <p className="text-sm" style={{ color: 'var(--ink-faded)' }}>让 Aurora 研究这个领域、立锚推演,产出「理解 + 脉络」给你参照。</p>
        </div>
        <button
          onClick={onPlanWithAurora}
          className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium outline-none transition-colors"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        >
          <Sparkles size={14} strokeWidth={1.8} /> 让 Aurora 规划
        </button>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[38rem] px-8 pb-20 pt-6">
      {/* 目标 */}
      {plan.goal && (
        <div className="mb-5 flex items-baseline gap-2.5 pb-4" style={{ borderBottom: '1px solid var(--separator)' }}>
          <span className="shrink-0 text-2xs uppercase" style={{ color: 'var(--ink-faded)', letterSpacing: '0.06em' }}>这次学</span>
          <span className="text-md" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>{plan.goal}</span>
        </div>
      )}

      {/* 理解(自然段:Aurora 向我解释思路) */}
      <div className="mb-2 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-faded)' }}>
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' }} />
        <span><b style={{ color: 'var(--ink)' }}>Aurora 的理解</b> · 研究后</span>
      </div>
      <div className="text-md" style={{ fontFamily: 'var(--font-serif)', lineHeight: 'var(--leading-reading, 1.75)' }}>
        <Prose text={plan.understanding} />
      </div>

      {/* 脉络(只读参考;建篇在右边自己来) */}
      {plan.items.length > 0 && (
        <>
          <div className="mb-1 mt-7">
            <span className="text-2xs uppercase" style={{ color: 'var(--ink-faded)', letterSpacing: '0.06em' }}>脉络 · 提案</span>
          </div>
          <div className="relative">
            <span className="absolute left-[60px] top-[18px] bottom-6 w-px" style={{ background: 'var(--separator)' }} />
            {plan.items.map((p, i) => {
              const prevThread = i > 0 ? plan.items[i - 1].thread : undefined;
              const showThread = p.thread !== prevThread;
              return (
                <div key={i} className="grid w-full items-start py-2.5" style={{ gridTemplateColumns: '48px 24px 1fr' }}>
                  <div className="flex justify-end pr-2 pt-[3px] text-2xs" style={{ color: showThread ? 'var(--ink-faded)' : 'transparent', letterSpacing: '0.04em' }}>{p.thread}</div>
                  <div className="relative flex justify-center pt-[7px]">
                    <span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)', boxShadow: '0 0 0 4px var(--paper)' }} />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="tabular-nums text-xs" style={{ color: 'var(--ink-ghost)' }}>{i + 1}</span>
                      <span className="text-md" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>{p.title}</span>
                    </div>
                    {p.why && <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-faded)', lineHeight: 1.65 }}>{p.why}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 右栏顶部:嵌入式「我的篇目」目录(可折叠 + dnd 拖排序)= 真树 ───────────────────

function SortableChapterRow({
  ch, index, current, onNavigate, onRename, onRemove,
}: {
  ch: Chapter;
  index: number;
  current: boolean;
  onNavigate: (contentItemId: string) => void;
  onRename: (navId: string, title: string) => void;
  onRemove: (navId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ch.navId });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ch.title);

  const startEdit = () => { setDraft(ch.title); setEditing(true); };
  const commit = () => { const t = draft.trim(); if (t && t !== ch.title) onRename(ch.navId, t); setEditing(false); };

  // 纯结构编辑:拖排序 + 序号 + 标题(点进入 / 改名) + 删。研究过实墨、没研究淡墨,不掺状态词。
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, background: current ? 'var(--accent-soft)' : undefined }}
      className="group flex items-center gap-1.5 rounded-md py-1.5 pl-1 pr-1.5 transition-colors hover:bg-[var(--shelf)]"
    >
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
        <button onClick={() => onNavigate(ch.contentItemId)} className="min-w-0 flex-1 truncate text-left text-sm outline-none" style={{ color: ch.studied ? 'var(--ink)' : 'var(--ink-faded)' }} title="进入这一篇">
          {ch.title}
        </button>
      )}

      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={startEdit} className="rounded p-1 outline-none hover:bg-[var(--paper)]" style={{ color: 'var(--ink-ghost)' }} title="改名"><Pencil size={12} strokeWidth={1.6} /></button>
          <button onClick={() => onRemove(ch.navId)} className="rounded p-1 outline-none hover:bg-[var(--paper)]" style={{ color: 'var(--ink-ghost)' }} title="删除这一篇"><X size={12} strokeWidth={1.8} /></button>
        </div>
      )}
    </div>
  );
}

function ChapterOutline({
  chapters, currentContentId, isTopic, onNavigate, onAdd, onRename, onRemove, onReorder,
}: {
  chapters: Chapter[];
  currentContentId: string | null;
  isTopic: boolean;
  onNavigate: (contentItemId: string) => void;
  onAdd: () => void;
  onRename: (navId: string, title: string) => void;
  onRemove: (navId: string) => void;
  onReorder: (navIds: string[]) => void;
}) {
  const [open, setOpen] = useState(isTopic);
  const currentIdx = chapters.findIndex((c) => c.contentItemId === currentContentId);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = chapters.findIndex((c) => c.navId === active.id);
    const to = chapters.findIndex((c) => c.navId === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(chapters, from, to).map((c) => c.navId));
  };

  return (
    <div className="mb-5 pb-3" style={{ borderBottom: '1px solid var(--separator)' }}>
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-md py-0.5 pr-1 outline-none" style={{ color: 'var(--ink-faded)' }}>
          {open ? <ChevronDown size={13} strokeWidth={1.8} /> : <ChevronRight size={13} strokeWidth={1.8} />}
          <span className="text-2xs uppercase" style={{ letterSpacing: '0.06em' }}>
            我的篇目{isTopic ? ` · ${chapters.length} 篇` : currentIdx >= 0 ? ` · 第 ${currentIdx + 1}/${chapters.length} 篇` : ''}
          </span>
        </button>
        {open && (
          <button onClick={onAdd} className="ml-auto flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs outline-none transition-colors hover:bg-[var(--shelf)]" style={{ color: 'var(--ink-faded)' }} title="凭空新建一篇">
            <Plus size={11} strokeWidth={2} /> 新建一篇
          </button>
        )}
      </div>

      {open &&
        (chapters.length === 0 ? (
          <p className="px-1 py-3 text-xs" style={{ color: 'var(--ink-ghost)' }}>照左边脉络「新建一篇」,搭起你的篇目。</p>
        ) : (
          <div className="mt-1.5">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={chapters.map((c) => c.navId)} strategy={verticalListSortingStrategy}>
                {chapters.map((c, i) => (
                  <SortableChapterRow key={c.navId} ch={c} index={i} current={c.contentItemId === currentContentId} onNavigate={onNavigate} onRename={onRename} onRemove={onRemove} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        ))}
    </div>
  );
}

function EditControls({ onSave, onCommit, saving }: { onSave: () => void; onCommit: () => void; saving: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <button onClick={onSave} disabled={saving} className="flex items-center gap-1 rounded-md px-2.5 py-1 text-sm outline-none transition-colors hover:bg-[var(--shelf)] disabled:opacity-40" style={{ color: 'var(--ink-faded)' }} title="保存草稿">
        {saving ? <Loader2 size={13} className="animate-spin" /> : null}保存
      </button>
      <button onClick={onCommit} disabled={saving} className="rounded-md px-3 py-1 text-sm outline-none transition-colors disabled:opacity-40" style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }} title="提交一个版本">提交</button>
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
  isTopic, nodeId, data, onNavigate,
}: {
  isTopic: boolean;
  nodeId: string; // 当前篇的 contentItemId(总章态为空)
  data: LearningData;
  onNavigate: (contentItemId: string | null) => void;
}) {
  const navigate = useNavigate();
  const { chapters, plan } = data;
  const currentCid = isTopic ? data.topicContentItemId : nodeId;
  const idx = isTopic ? -1 : chapters.findIndex((c) => c.contentItemId === nodeId);
  const chapter = idx >= 0 ? chapters[idx] : null;
  const prev = idx > 0 ? chapters[idx - 1].contentItemId : null;
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1].contentItemId : null;
  const title = isTopic ? data.topicTitle : chapter?.title ?? '';

  // 继续学习:跳到顺序上最新的已研究篇;都没研究则落第一篇。
  const anyResearched = chapters.some((c) => c.studied);
  const resume = [...chapters].reverse().find((c) => c.studied) ?? chapters[0] ?? null;

  // 当前业务场景状态串(实时拼、无正文)→ 后端拼进 <current_context>。状态二态:已研究(有 AI 稿)/ 空。
  const planGoal = data.plan?.goal ? `(目标:${data.plan.goal})` : '';
  const learningContextStr =
    (isTopic
      ? `在规划《${data.topicTitle}》${planGoal}。`
      : `在学《${data.topicTitle}》${planGoal},当前第 ${idx + 1}/共 ${chapters.length} 篇《${title}》。`) +
    '\n' +
    (chapters.length
      ? '篇目:\n' +
        chapters.map((c, i) => `  ${i + 1}. ${c.title}    ${c.studied ? '已研究' : '空'}`).join('\n')
      : '篇目:(还没建,照规划新建一篇)');

  // 当前篇的内容(左 aiDraft / 右 myDraft),按 contentItemId 拉;总章态左是规划提案不拉 aiDraft。
  const [content, setContent] = useState<{ aiDraft: string; myDraft: string } | null>(null);
  const [leftVer, setLeftVer] = useState(0); // aiDraft 刷新时强制左栏只读编辑器重挂
  const mdRef = useRef('');
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (!currentCid) {
      queueMicrotask(() => {
        if (!alive) return;
        mdRef.current = '';
        setContent({ aiDraft: '', myDraft: '' });
      });
      return () => {
        alive = false;
      };
    }
    queueMicrotask(() => {
      if (alive) setContent(null); // 切节点先置 loading
    });
    void Promise.all([
      isTopic ? Promise.resolve(null) : notesApi.getAiDraft(currentCid).catch(() => null),
      notesApi.getDraft(currentCid).catch(() => null),
    ]).then(([ai, mine]) => {
      if (!alive) return;
      const my = mine?.bodyMarkdown ?? '';
      mdRef.current = my;
      setContent({ aiDraft: ai?.bodyMarkdown ?? '', myDraft: my });
    });
    return () => {
      alive = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [isTopic, currentCid]);

  const doSaveDraft = useCallback(async (md: string) => {
    if (!currentCid) return;
    setSaving(true);
    try {
      await notesApi.saveDraft(currentCid, { title: title || '未命名', summary: '', bodyMarkdown: md, changeNote: '' });
    } finally {
      setSaving(false);
    }
  }, [currentCid, title]);

  const onEditorChange = (md: string, isUserEdit: boolean) => {
    mdRef.current = md;
    if (!isUserEdit) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void doSaveDraft(md), AUTOSAVE_MS);
  };
  const onSaveNow = () => void doSaveDraft(mdRef.current);
  const onCommit = useCallback(async () => {
    if (!currentCid) return;
    setSaving(true);
    try {
      await notesApi.save(currentCid, { title: title || '未命名', summary: '', status: 'committed', bodyMarkdown: mdRef.current, changeNote: '学习重写' });
    } finally {
      setSaving(false);
    }
  }, [currentCid, title]);

  const studied = (content?.aiDraft.trim().length ?? 0) > 0;

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

  // 收起 Aurora 后刷新左栏:总章重读规划、叶子重读 AI 初稿(模型可能刚 write_learn_plan / write_draft)。
  const closeAurora = () => {
    setAuroraOpen(false);
    if (isTopic) {
      void data.reload();
    } else if (currentCid) {
      notesApi.getAiDraft(currentCid)
        .then((d) => {
          setContent((c) => (c ? { ...c, aiDraft: d?.bodyMarkdown ?? c.aiDraft } : c));
          setLeftVer((v) => v + 1);
        })
        .catch(() => {});
      void data.refreshStudied(currentCid);
    }
  };

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
            {/* 章节切换器:‹ › 紧邻上下篇,点篇名弹列表跳任意篇;回主题挪到右侧主操作 pill */}
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
                  <DropdownMenuItem key={c.navId} onClick={() => onNavigate(c.contentItemId)} className="gap-2 text-sm">
                    <span className="w-4 shrink-0 text-right tabular-nums text-2xs" style={{ color: 'var(--ink-ghost)' }}>{i + 1}</span>
                    <span className="flex-1 truncate" style={{ color: c.contentItemId === nodeId ? 'var(--accent)' : 'var(--ink)' }}>{c.title}</span>
                    {c.contentItemId === nodeId && <Check size={13} strokeWidth={2} style={{ color: 'var(--accent)' }} />}
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
              <button
                onClick={() => onNavigate(resume.contentItemId)}
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
          {!isTopic && (
            <>
              <button
                onClick={() => onNavigate(null)}
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
            onClick={() => (auroraOpen ? closeAurora() : setAuroraOpen(true))}
            title="唤出 / 收起 Aurora"
            aria-pressed={auroraOpen}
          >
            <Sparkles size={15} strokeWidth={1.5} />
            Aurora
          </button>
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--separator)' }} />
          <EditControls onSave={onSaveNow} onCommit={() => void onCommit()} saving={saving} />
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
              <PlanProduct plan={plan} onPlanWithAurora={() => setAuroraOpen(true)} />
            ) : content === null ? (
              <div className="flex h-full items-center justify-center"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--ink-ghost)' }} /></div>
            ) : studied ? (
              <div className="mx-auto w-full max-w-[var(--layout-editor-max)] pb-24 pt-2">
                <DraftAssetProvider contentItemId={currentCid ?? ''}>
                  <PlateMarkdownEditor key={`d-${nodeId}-${leftVer}`} initialMarkdown={content.aiDraft} readOnly />
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
                  onClick={() => setAuroraOpen(true)}
                  className="flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium outline-none transition-colors"
                  style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
                >
                  <Sparkles size={14} strokeWidth={1.8} /> 让 Aurora 起草这一篇
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右:我的(总章顶部嵌篇目目录 + 正文重写) */}
        <div
          className="relative min-h-0 shrink-0 overflow-hidden"
          style={{ background: 'var(--paper)', width: slid ? 0 : '50%', transition: `width ${SLIDE_MS}ms cubic-bezier(0.32, 0.72, 0, 1)` }}
        >
          <div ref={rewriteScrollRef} className="h-full overflow-y-auto" style={{ opacity: rewriteVisible ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}>
            <div className={`mx-auto w-full max-w-[var(--layout-editor-max)] pb-40 ${isTopic ? 'px-2 pt-4' : 'pt-2'}`}>
              {isTopic && (
                <ChapterOutline
                  chapters={chapters}
                  currentContentId={nodeId || null}
                  isTopic={isTopic}
                  onNavigate={(cid) => onNavigate(cid)}
                  onAdd={() => void data.createChapter()}
                  onRename={(navId, t) => void data.renameChapter(navId, t)}
                  onRemove={(navId) => void data.removeChapter(navId)}
                  onReorder={(navIds) => void data.reorderChapters(navIds)}
                />
              )}
              {content === null ? (
                <div className="flex items-center justify-center py-20"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--ink-ghost)' }} /></div>
              ) : (
                <DraftAssetProvider contentItemId={currentCid ?? ''}>
                  <PlateMarkdownEditor key={`r-${nodeId}`} initialMarkdown={content.myDraft} onChange={onEditorChange} />
                </DraftAssetProvider>
              )}
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
              key={`a-${nodeId || 'topic'}`}
              sessionKey={`learn-${currentCid ?? 'topic'}`}
              agentKey={isTopic ? 'learning-planner' : 'learning-writer'}
              source="learning-editor"
              context={
                isTopic
                  ? { learningTopicId: currentCid ?? undefined, learningContext: learningContextStr }
                  : { learningNoteId: currentCid ?? undefined, learningContext: learningContextStr }
              }
              greeting={isTopic ? '想学什么领域?我来立锚、推演脉络。' : studied ? '想改这篇初稿的哪里?' : '这一篇要研究什么?我来起草。'}
              selectionAttachments={selections}
              onRemoveSelectionAttachment={removeSelection}
              onClearSelectedText={clearSelections}
              onClose={closeAurora}
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
  const { id: topicNavId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const data = useLearningData(topicNavId);

  const param = searchParams.get('node');
  const currentCid = param && data.chapters.some((c) => c.contentItemId === param) ? param : null;
  const isTopic = !currentCid;

  // 删的正是当前篇时,落回总章(由调用方触发后,param 已失配 → 自然回总章,这里只管导航 setter)
  const onNavigate = (cid: string | null) => setSearchParams(cid ? { node: cid } : {});

  if (data.loading) return <LoadingState variant="full" />;
  if (data.error) {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: 'var(--paper)' }}>
        <div className="text-center">
          <p className="text-md" style={{ color: 'var(--ink)', fontFamily: 'var(--font-serif)' }}>学习加载失败</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--ink-faded)' }}>{data.error}</p>
          <button onClick={() => void data.reload()} className="mt-4 rounded-md px-3.5 py-1.5 text-sm font-medium outline-none" style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <NodeScreen
      key={currentCid ?? '__topic__'}
      isTopic={isTopic}
      nodeId={currentCid ?? ''}
      data={data}
      onNavigate={onNavigate}
    />
  );
}
