/*
 * useLearningData — 学习视图的真数据层。
 *
 * 篇目 = 主题 NavigationNode 的子节点(走 structureApi,即外面 /admin/notes 那棵真树,双向同步)。
 * 规划提案 = 主题节点的 aidraft(write_learn_plan 落库的 frontmatter),解析成 goal/understanding/items。
 * 每篇的"研究过没有" = 该篇 contentItemId 有没有非空 aidraft。
 *
 * 结构 CRUD(建/改名/排序/删)直接打 structureApi;读写正文走 notesApi(draft / aidraft)。
 */

import { useCallback, useEffect, useState } from 'react';
import { structureApi } from '@/services/structure';
import { notesApi } from '@/services/workspace';
import { banner } from '@/components/ui/banner-api';

export interface PlanItem {
  title: string;
  thread: string;
  why: string;
}
export interface LearnPlan {
  goal: string;
  understanding: string;
  items: PlanItem[];
}
export interface Chapter {
  navId: string; // NavigationNode._id —— 结构操作(改名/删/排序)用
  contentItemId: string; // ContentItem._id —— 读写草稿 / Aurora 上下文 / 导航 ?node 用
  title: string;
  studied: boolean; // 有非空 aidraft = 研究过
}

// ─── 解析 write_learn_plan 的 frontmatter 契约 ──────────────────────────────────
// 后端 js-yaml dump(lineWidth:-1) 产出固定形状,标量不折行:
//   ---
//   goal: <...>
//   items:
//     - title: <...>
//       thread: <...>
//       why: <...>
//   ---
//   <understanding 散文>
// client 无 yaml 库,按这一固定形状手解析(处理 js-yaml 的单/双引号转义),不靠正则猜整体。

function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return s;
}

export function parseLearnPlan(body: string | null | undefined): LearnPlan | null {
  if (!body) return null;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (!m) return null;
  const understanding = body.slice(m[0].length).replace(/^\n+/, '');
  let goal = '';
  const items: PlanItem[] = [];
  let cur: PlanItem | null = null;
  let inItems = false;
  for (const raw of m[1].split('\n')) {
    const goalM = /^goal:\s*(.*)$/.exec(raw);
    if (goalM) {
      goal = unquote(goalM[1]);
      inItems = false;
      continue;
    }
    if (/^items:\s*$/.test(raw)) {
      inItems = true;
      continue;
    }
    if (!inItems) continue;
    const t = /^\s*-\s*title:\s*(.*)$/.exec(raw);
    if (t) {
      if (cur) items.push(cur);
      cur = { title: unquote(t[1]), thread: '', why: '' };
      continue;
    }
    const th = /^\s+thread:\s*(.*)$/.exec(raw);
    if (th && cur) {
      cur.thread = unquote(th[1]);
      continue;
    }
    const w = /^\s+why:\s*(.*)$/.exec(raw);
    if (w && cur) {
      cur.why = unquote(w[1]);
      continue;
    }
  }
  if (cur) items.push(cur);
  return { goal, understanding, items };
}

// ─── hook ───────────────────────────────────────────────────────────────────────

export interface LearningData {
  loading: boolean;
  error: string | null;
  topicContentItemId: string | null;
  topicTitle: string;
  chapters: Chapter[];
  plan: LearnPlan | null;
  reload: () => Promise<void>;
  createChapter: () => Promise<string | null>; // 返回新篇的 navId(供新建后立即进改名态)
  renameChapter: (navId: string, title: string) => Promise<void>;
  removeChapter: (navId: string) => Promise<void>;
  reorderChapters: (navIds: string[]) => Promise<void>;
  setStudied: (contentItemId: string, studied: boolean) => void;
  refreshPlan: () => Promise<void>; // 只重读主题 aidraft 重解析规划(Aurora 规划完实时刷左栏)
}

export function useLearningData(topicNavId: string): LearningData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topicContentItemId, setTopicContentItemId] = useState<string | null>(null);
  const [topicTitle, setTopicTitle] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [plan, setPlan] = useState<LearnPlan | null>(null);

  const load = useCallback(async () => {
    if (!topicNavId) {
      setError('缺少主题节点');
      return;
    }
    try {
      setError(null);
      // visibility:'all' —— 管理端学习视图要看到未发布的新建篇目(默认 public 会把它们滤掉)
      const res = await structureApi.getChildren(topicNavId, {
        scope: 'notes',
        visibility: 'all',
      });
      // path 是面包屑,末项(或 id 匹配项)= 主题节点本身,从中取它的 contentItemId
      let self =
        res.path.find((p) => p.id === topicNavId) ?? res.path[res.path.length - 1];
      if (!self?.contentItemId) {
        // 兜底:getChildren 的 path 不含自身/无 contentItemId 时,显式取该节点路径
        const path = await structureApi
          .getPathByNodeId(topicNavId)
          .catch(() => [] as typeof res.path);
        self = path.find((p) => p.id === topicNavId) ?? path[path.length - 1] ?? self;
      }
      const topicCid = self?.contentItemId ?? null;
      setTopicContentItemId(topicCid);
      setTopicTitle(self?.name ?? '学习');

      const kids = res.children;
      // 一次批量探针判每篇是否研究过(有非空 aidraft);整批失败按"都没研究"降级,不阻塞整体。
      // 替掉原先「逐篇 getAiDraft 拉整篇正文只为一个布尔」的 N 个重复请求 + 流量浪费。
      const cids = kids
        .map((c) => c.contentItemId)
        .filter((id): id is string => !!id);
      const studiedSet = new Set(
        cids.length
          ? await notesApi
              .aidraftsExist(cids)
              .then((r) => r.ids)
              .catch(() => [] as string[])
          : [],
      );
      setChapters(
        kids.map((c) => ({
          navId: c.id,
          contentItemId: c.contentItemId ?? '',
          title: c.name,
          studied: !!c.contentItemId && studiedSet.has(c.contentItemId),
        })),
      );

      if (topicCid) {
        const planDraft = await notesApi.getAiDraft(topicCid).catch(() => null);
        setPlan(parseLearnPlan(planDraft?.bodyMarkdown));
      } else {
        setPlan(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [topicNavId]);

  useEffect(() => {
    // load() 内有同步 setState,整体推迟一拍避免 set-state-in-effect 级联渲染告警
    queueMicrotask(() => {
      setLoading(true);
      void load();
    });
  }, [load]);

  // 写操作统一:失败弹 banner + reload 把乐观更新纠回服务端真值(不静默吞错,守 CLAUDE.md "catch 必 log/提示")。
  const createChapter = useCallback(async () => {
    try {
      const node = await structureApi.createNode({
        name: '未命名',
        type: 'DOC', // 篇 = 叶子文档节点
        parentId: topicNavId,
        scope: 'notes',
      });
      await load();
      return node.id; // navId,供调用方新建后立即让该行进改名态
    } catch (e) {
      banner.error(e instanceof Error ? e.message : '新建篇目失败');
      return null;
    }
  }, [topicNavId, load]);

  const renameChapter = useCallback(
    async (navId: string, title: string) => {
      setChapters((cs) => cs.map((c) => (c.navId === navId ? { ...c, title } : c)));
      try {
        await structureApi.updateNode(navId, { name: title });
      } catch (e) {
        banner.error(e instanceof Error ? e.message : '改名失败');
        await load();
      }
    },
    [load],
  );

  const removeChapter = useCallback(
    async (navId: string) => {
      setChapters((cs) => cs.filter((c) => c.navId !== navId));
      try {
        await structureApi.deleteNode(navId);
      } catch (e) {
        banner.error(e instanceof Error ? e.message : '删除失败');
        await load();
      }
    },
    [load],
  );

  const reorderChapters = useCallback(
    async (navIds: string[]) => {
      // 乐观重排,再持久化;失败弹 banner + reload 纠回。
      setChapters((cs) =>
        navIds
          .map((id) => cs.find((c) => c.navId === id))
          .filter((c): c is Chapter => !!c),
      );
      try {
        await structureApi.reorderSiblings(topicNavId, navIds);
      } catch (e) {
        banner.error(e instanceof Error ? e.message : '排序失败');
        await load();
      }
    },
    [topicNavId, load],
  );

  // 纯 setter:由调用方(refreshLeft 拉到 body 后)直接告知 studied,不再自己重拉 aidraft。
  // 消掉「refreshLeft 拉一遍 body + refreshStudied 内部又拉一遍同一 aidraft」的重复请求。
  const setStudied = useCallback((contentItemId: string, studied: boolean) => {
    setChapters((cs) =>
      cs.map((c) => (c.contentItemId === contentItemId ? { ...c, studied } : c)),
    );
  }, []);

  // 只重读主题 aidraft + 重解析规划(轻量,供 Aurora 规划期间轮询实时刷左栏,不动篇目)
  const refreshPlan = useCallback(async () => {
    if (!topicContentItemId) return;
    const d = await notesApi.getAiDraft(topicContentItemId).catch(() => null);
    setPlan(parseLearnPlan(d?.bodyMarkdown));
  }, [topicContentItemId]);

  return {
    loading,
    error,
    topicContentItemId,
    topicTitle,
    chapters,
    plan,
    reload: load,
    createChapter,
    renameChapter,
    removeChapter,
    reorderChapters,
    setStudied,
    refreshPlan,
  };
}
