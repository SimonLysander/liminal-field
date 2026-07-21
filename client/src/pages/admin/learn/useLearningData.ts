/*
 * useLearningData — 学习视图的真数据层。
 *
 * 篇目 = 主题 NavigationNode 的子节点(走 structureApi,即外面 /admin/notes 那棵真树,双向同步)。
 * 规划提案 = 后端从主题 aidraft 解析出的结构化学习规划。
 * 每篇的"研究过没有" = 该篇 contentItemId 有没有非空 aidraft。
 *
 * 结构 CRUD(建/排序/删)直接打 structureApi;读写正文和标题走 notesApi(draft / aidraft)。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { structureApi, type StructureNode } from '@/services/structure';
import { notesApi, type LearnPlan } from '@/services/workspace';
import { banner } from '@/components/ui/banner-api';
import { createLogger } from '@/lib/logger';

export interface Chapter {
  navId: string; // NavigationNode._id —— 结构操作(删/排序)用
  contentItemId: string; // ContentItem._id —— 读写草稿 / Aurora 上下文 / 导航 ?node 用
  title: string;
  depth: number;
  parentId?: string;
  studied: boolean; // 有非空 aidraft = 研究过
}

const logger = createLogger('learn-plan');

// ─── hook ───────────────────────────────────────────────────────────────────────

export interface LearningData {
  loading: boolean;
  error: string | null;
  topicContentItemId: string | null;
  topicTitle: string;
  allChapters: Chapter[];
  chapters: Chapter[];
  plan: LearnPlan | null;
  planError: string | null;
  reload: () => Promise<void>;
  createChapter: (title: string) => Promise<string | null>; // 返回新篇的 contentItemId,供创建后进入编辑
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
  const [allChapters, setAllChapters] = useState<Chapter[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [plan, setPlan] = useState<LearnPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const planRequestIdRef = useRef(0);

  const loadPlan = useCallback(async (contentItemId: string | null) => {
    const requestId = ++planRequestIdRef.current;
    setPlanError(null);
    if (!contentItemId) {
      setPlan(null);
      return;
    }
    try {
      const nextPlan = await notesApi.getLearnPlan(contentItemId);
      if (requestId === planRequestIdRef.current) setPlan(nextPlan);
    } catch (cause) {
      if (requestId !== planRequestIdRef.current) return;
      const message = cause instanceof Error ? cause.message : '加载学习规划失败';
      setPlanError(message);
      logger.error('load_plan_failed', {
        contentItemId,
        errorType: cause instanceof Error ? cause.name : 'Unknown',
      });
    }
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    // 主题切换/整体重载时立即使之前的独立规划刷新失效。
    planRequestIdRef.current += 1;
    if (!topicNavId) {
      setError('缺少主题节点');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      setPlan(null);
      setPlanError(null);
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

      const kids = res.children;
      const allNodes = await collectDescendantNodes(topicNavId, kids);
      // 一次批量探针判每篇是否研究过(有非空 aidraft);整批失败按"都没研究"降级,不阻塞整体。
      // 替掉原先「逐篇 getAiDraft 拉整篇正文只为一个布尔」的 N 个重复请求 + 流量浪费。
      const cids = allNodes
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
      const toChapter = (c: TreeNodeRef): Chapter => ({
          navId: c.id,
          contentItemId: c.contentItemId ?? '',
          title: c.name,
          depth: c.depth,
          parentId: c.parentId,
          studied: !!c.contentItemId && studiedSet.has(c.contentItemId),
        });
      if (requestId !== loadRequestIdRef.current) return;
      setTopicContentItemId(topicCid);
      setTopicTitle(self?.name ?? '学习');
      setAllChapters(allNodes.map(toChapter));
      setChapters(kids.map((c) => toChapter({ ...c, depth: 0 })));
      await loadPlan(topicCid);
    } catch (e) {
      if (requestId === loadRequestIdRef.current) {
        setError(e instanceof Error ? e.message : '加载失败');
      }
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [loadPlan, topicNavId]);

  useEffect(() => {
    // load() 内有同步 setState,整体推迟一拍避免 set-state-in-effect 级联渲染告警
    queueMicrotask(() => {
      setLoading(true);
      void load();
    });
  }, [load]);

  // 写操作统一:失败弹 banner + reload 把乐观更新纠回服务端真值(不静默吞错,守 CLAUDE.md "catch 必 log/提示")。
  const createChapter = useCallback(async (title: string) => {
    try {
      const node = await structureApi.createNode({
        name: title,
        type: 'DOC', // 篇 = 叶子文档节点
        parentId: topicNavId,
        scope: 'notes',
      });
      await load();
      return node.contentItemId ?? null;
    } catch (e) {
      banner.error(e instanceof Error ? e.message : '新建篇目失败');
      return null;
    }
  }, [topicNavId, load]);

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
    setAllChapters((cs) =>
      cs.map((c) => (c.contentItemId === contentItemId ? { ...c, studied } : c)),
    );
    setChapters((cs) =>
      cs.map((c) => (c.contentItemId === contentItemId ? { ...c, studied } : c)),
    );
  }, []);

  // 只重读结构化规划（轻量，供 Aurora 规划期间实时刷新左栏，不动篇目）。
  const refreshPlan = useCallback(async () => {
    if (!topicContentItemId) return;
    await loadPlan(topicContentItemId);
  }, [loadPlan, topicContentItemId]);

  return {
    loading,
    error,
    topicContentItemId,
    topicTitle,
    allChapters,
    chapters,
    plan,
    planError,
    reload: load,
    createChapter,
    removeChapter,
    reorderChapters,
    setStudied,
    refreshPlan,
  };
}

type TreeNodeRef = {
  id: string;
  name: string;
  parentId?: string;
  contentItemId?: string;
  depth: number;
};

async function collectDescendantNodes(
  rootNodeId: string,
  rootChildren?: StructureNode[],
): Promise<TreeNodeRef[]> {
  const result: TreeNodeRef[] = [];

  async function visit(
    parentId: string,
    depth: number,
    knownChildren?: StructureNode[],
  ) {
    const children =
      knownChildren ??
      (
        await structureApi.getChildren(parentId, {
          scope: 'notes',
          visibility: 'all',
        })
      ).children;
    for (const child of children) {
      result.push({
        id: child.id,
        name: child.name,
        parentId: child.parentId,
        contentItemId: child.contentItemId,
        depth,
      });
      if (child.hasChildren) {
        await visit(child.id, depth + 1);
      }
    }
  }

  await visit(rootNodeId, 0, rootChildren);
  return result;
}
