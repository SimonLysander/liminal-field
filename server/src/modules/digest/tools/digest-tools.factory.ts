/**
 * DigestToolsFactory — v4：给每次 react-agent loop 构建绑定到该任务的工具集（4 工具）。
 *
 * 核心设计（v4 vs v3 的主要变化）：
 * - 删除 list_sources / search / view 三个工具：
 *   - list_sources：源列表改由 system prompt 注入，LLM 开场即知（不需要工具查询）。
 *   - search：LLM 直接用 web_search 更灵活（跨全网而非只搜订阅源内）。
 *   - view：统一用 web_fetch 按 URL 深读，不再走 ref→fetchedItemsMap→fetcher.readFull。
 * - TaskContext 删除 sourceRefsMap（不再分配 s1/s2 ref），
 *   fetchedItemsMap 的 value 从 { sourceRef, sourceName } 改为 { sourceId, sourceName }。
 * - buildToolset 按 env 判断是否挂 web_search（无 TAVILY_API_KEY → 不挂）。
 * - web_fetch 始终可用（provider 走 DirectFetch / Jina，总会返回）。
 */
import { Injectable } from '@nestjs/common';
import type { FetchedItem } from '../fetchers/fetcher.interface'; // 仅 type import，无需 IoC
// import type 用于 @Injectable 构造器参数会导致 NestJS IoC 运行时无法解析，改为正式 import
import { InfoSourceRepository } from '../info-source.repository';
import { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import { ProcessedFeedItemRepository } from '../processed-feed-item.repository';
import { DigestTaskRepository } from '../digest-task.repository';

import { createBrowseTool } from './browse.tool';
import {
  createWebSearchTool,
  createWebSearchProviderFromEnv,
} from './web-search.tool';
import {
  createWebFetchTool,
  createWebFetchProviderFromEnv,
} from './web-fetch.tool';
import { createPickTool } from './pick.tool';

/** 工具执行期内部状态，每个 loop 独立实例，不跨任务共享 */
export interface TaskContext {
  taskId: string;
  topicId: string;
  refCounter: { item: number };
  /**
   * ref（i1, i2, ...）→ { fetchedItem, sourceId, sourceName }。
   * browse 写入，pick 读取；sourceId 是 src_xxx 格式（直接用，不再经 sourceRefsMap 二次反查）。
   */
  fetchedItemsMap: Map<
    string,
    { fetchedItem: FetchedItem; sourceId: string; sourceName: string }
  >;
}

export interface DigestToolset {
  browse: ReturnType<typeof createBrowseTool>;
  /** 可选：env 未配 TAVILY_API_KEY 时不挂，LLM 看不到此工具 */
  web_search?: ReturnType<typeof createWebSearchTool>;
  web_fetch: ReturnType<typeof createWebFetchTool>;
  pick: ReturnType<typeof createPickTool>;
}

@Injectable()
export class DigestToolsFactory {
  constructor(
    private readonly infoSourceRepo: InfoSourceRepository,
    private readonly fetcherRegistry: FetcherRegistry,
    private readonly pfiRepo: ProcessedFeedItemRepository,
    private readonly taskRepo: DigestTaskRepository,
  ) {}

  /** 给一次 react-agent loop 创建独立的 TaskContext（状态不跨任务共享）。 */
  createTaskContext(taskId: string, topicId: string): TaskContext {
    return {
      taskId,
      topicId,
      refCounter: { item: 0 },
      fetchedItemsMap: new Map(),
    };
  }

  /** 构建 4 个工具，全部绑定到传入的 ctx（同一 loop 共享同一 ctx）。 */
  buildToolset(ctx: TaskContext): DigestToolset {
    // web_search 可选挂载：无 TAVILY_API_KEY 时 provider 为 undefined，不挂工具
    const webSearchProvider = createWebSearchProviderFromEnv();
    // web_fetch 必挂：provider 始终返回（默认 direct），无需 key
    const webFetchProvider = createWebFetchProviderFromEnv();

    return {
      browse: createBrowseTool({
        infoSourceRepo: this.infoSourceRepo,
        fetcherRegistry: this.fetcherRegistry,
        pfiRepo: this.pfiRepo,
        ctx,
      }),
      ...(webSearchProvider
        ? { web_search: createWebSearchTool(webSearchProvider) }
        : {}),
      web_fetch: createWebFetchTool(webFetchProvider),
      pick: createPickTool({
        taskRepo: this.taskRepo,
        ctx,
      }),
    };
  }
}
