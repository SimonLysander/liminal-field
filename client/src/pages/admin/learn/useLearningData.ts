/*
 * useLearningData — 学习视图的真数据层。
 *
 * 篇目 = 主题 NavigationNode 的子节点(走 structureApi,即外面 /admin/notes 那棵真树,双向同步)。
 * 规划提案 = 后端从主题 aidraft 解析出的结构化学习规划。
 * 每篇的"研究过没有" = 该篇 contentItemId 有没有非空 aidraft。
 *
 * 结构 CRUD(建/排序/删)直接打 structureApi;读写正文和标题走 notesApi(draft / aidraft)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { structureApi } from '@/services/structure';
import { learningApi } from '@/services/learning';
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
  isIndependentLearningRoot: boolean;
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
  // 一个目录状态同时驱动篇目列表与正文导航，避免结构操作后两份顺序分离。
  const chapters = useMemo(() => allChapters.filter((chapter) => chapter.depth === 0), [allChapters]);
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
      const outline = await learningApi.outline(topicNavId);
      const topicCid = outline.rootNode.contentItemId ?? null;
      // 一次批量探针判每篇是否研究过(有非空 aidraft);整批失败按"都没研究"降级,不阻塞整体。
      // 替掉原先「逐篇 getAiDraft 拉整篇正文只为一个布尔」的 N 个重复请求 + 流量浪费。
      const cids = outline.chapters
        .filter((chapter) => !chapter.isIndependentLearningRoot)
        .map((chapter) => chapter.node.contentItemId)
        .filter((id): id is string => !!id);
      const studiedSet = new Set(
        cids.length
          ? await notesApi
              .aidraftsExist(cids)
              .then((r) => r.ids)
              .catch((cause) => {
                logger.warn('load_studied_status_failed', {
                  topicNavId,
                  error: cause instanceof Error ? cause.message : String(cause),
                });
                return [] as string[];
              })
          : [],
      );
      if (requestId !== loadRequestIdRef.current) return;
      setTopicContentItemId(topicCid);
      setTopicTitle(outline.rootNode.name);
      setAllChapters(outline.chapters.map(({ node, depth, isIndependentLearningRoot }) => ({
        navId: node.id,
        contentItemId: node.contentItemId ?? '',
        title: node.name,
        depth,
        parentId: node.parentId,
        studied: !isIndependentLearningRoot && !!node.contentItemId && studiedSet.has(node.contentItemId),
        isIndependentLearningRoot,
      })));
      await loadPlan(topicCid);
    } catch (e) {
      if (requestId === loadRequestIdRef.current) {
        setError(e instanceof Error ? e.message : '加载失败');
        logger.error('load_directory_failed', { topicNavId, error: e instanceof Error ? e.message : String(e) });
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

  // 结构变更完成后统一重读后端目录，删除、排序和归属共用同一份权威状态。
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
      try {
        await structureApi.deleteNode(navId);
      } catch (e) {
        logger.error('delete_chapter_failed', { navId, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
      await load();
    },
    [load],
  );

  const reorderChapters = useCallback(
    async (navIds: string[]) => {
      try {
        await structureApi.reorderSiblings(topicNavId, navIds);
      } catch (e) {
        banner.error(e instanceof Error ? e.message : '排序失败');
        logger.error('reorder_chapters_failed', { topicNavId, error: e instanceof Error ? e.message : String(e) });
      }
      await load();
    },
    [topicNavId, load],
  );

  // 纯 setter:由调用方(refreshLeft 拉到 body 后)直接告知 studied,不再自己重拉 aidraft。
  // 消掉「refreshLeft 拉一遍 body + refreshStudied 内部又拉一遍同一 aidraft」的重复请求。
  const setStudied = useCallback((contentItemId: string, studied: boolean) => {
    setAllChapters((cs) =>
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
