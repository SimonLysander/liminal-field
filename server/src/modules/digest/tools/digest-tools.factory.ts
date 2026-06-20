/**
 * DigestToolsFactory — v3：给每次 react-agent loop 构建绑定到该任务的工具集（5 工具）。
 *
 * 核心设计（v3 vs v2 的主要变化）：
 * - TaskContext 持有 sourceRefsMap（ref→InfoSource）和 fetchedItemsMap（ref→FetchedItem+meta），
 *   LLM 全程用 ref（s1/i1）而非内部 ID（src_xxx/itemGuid），减少 LLM 参数编造的风险。
 * - refCounter 全局自增：source ref（s1,s2...）随 list_sources 分配；
 *   item ref（i1,i2...）随 browse/search 全局累积（避免跨批次 ref 复用混淆）。
 * - 5 工具：list_sources / browse / search / view / pick（去掉 get_recent_picks，去重在 browse/search 内部做）。
 */
import { Injectable } from '@nestjs/common';
import type { FetchedItem } from '../fetchers/fetcher.interface';
import type { InfoSource } from '../info-source.entity';
import type { InfoSourceRepository } from '../info-source.repository';
import type { SmartTopicConfigRepository } from '../smart-topic-config.repository';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../processed-feed-item.repository';
import type { DigestTaskRepository } from '../digest-task.repository';

import { createListSourcesTool } from './list-sources.tool';
import { createBrowseTool } from './browse.tool';
import { createSearchTool } from './search.tool';
import { createViewTool } from './view.tool';
import { createPickTool } from './pick.tool';

/** 工具执行期内部状态，每个 loop 独立实例，不跨任务共享 */
export interface TaskContext {
  taskId: string;
  topicId: string;
  refCounter: { source: number; item: number };
  /** ref（s1,s2,...）→ InfoSource，list_sources 写入，browse/search/view 读取 */
  sourceRefsMap: Map<string, InfoSource>;
  /** ref（i1,i2,...）→ { fetchedItem, sourceRef, sourceName }，browse/search 写入，view/pick 读取 */
  fetchedItemsMap: Map<
    string,
    { fetchedItem: FetchedItem; sourceRef: string; sourceName: string }
  >;
}

export interface DigestToolset {
  list_sources: ReturnType<typeof createListSourcesTool>;
  browse: ReturnType<typeof createBrowseTool>;
  search: ReturnType<typeof createSearchTool>;
  view: ReturnType<typeof createViewTool>;
  pick: ReturnType<typeof createPickTool>;
}

@Injectable()
export class DigestToolsFactory {
  constructor(
    private readonly infoSourceRepo: InfoSourceRepository,
    private readonly stcRepo: SmartTopicConfigRepository,
    private readonly fetcherRegistry: FetcherRegistry,
    private readonly pfiRepo: ProcessedFeedItemRepository,
    private readonly taskRepo: DigestTaskRepository,
  ) {}

  /** 给一次 react-agent loop 创建独立的 TaskContext（状态不跨任务共享）。 */
  createTaskContext(taskId: string, topicId: string): TaskContext {
    return {
      taskId,
      topicId,
      refCounter: { source: 0, item: 0 },
      sourceRefsMap: new Map(),
      fetchedItemsMap: new Map(),
    };
  }

  /** 构建 5 个工具，全部绑定到传入的 ctx（同一 loop 共享同一 ctx）。 */
  buildToolset(ctx: TaskContext): DigestToolset {
    return {
      list_sources: createListSourcesTool({
        infoSourceRepo: this.infoSourceRepo,
        stcRepo: this.stcRepo,
        ctx,
      }),
      browse: createBrowseTool({
        fetcherRegistry: this.fetcherRegistry,
        pfiRepo: this.pfiRepo,
        ctx,
      }),
      search: createSearchTool({
        fetcherRegistry: this.fetcherRegistry,
        pfiRepo: this.pfiRepo,
        stcRepo: this.stcRepo,
        ctx,
      }),
      view: createViewTool({
        fetcherRegistry: this.fetcherRegistry,
        ctx,
      }),
      pick: createPickTool({
        taskRepo: this.taskRepo,
        ctx,
      }),
    };
  }
}
