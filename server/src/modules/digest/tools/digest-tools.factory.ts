/**
 * DigestToolsFactory — 给每次 react-agent loop 构建一套绑定到该任务的工具集。
 *
 * 核心设计：
 * - 每个 loop 调用 buildToolset() 产生独立的工具实例（避免跨任务状态污染）。
 * - fetchedItemsMap 是 loop 内部状态：fetch / search 工具执行后通过 onItems 回调
 *   把拿到的 items 写入 map（key=itemGuid），save_finding 后续可反查 title/url/snippet。
 * - taskContext 绑定 taskId，save_finding 据此写入正确的 DigestTask。
 *
 * 工具命名遵循 §4 工具集规格，key 名即 LLM 调用时用的工具名。
 */
import { Injectable } from '@nestjs/common';
import type { FetchedItem } from '../fetchers/fetcher.interface';
import type { InfoSourceRepository } from '../info-source.repository';
import type { SmartTopicConfigRepository } from '../smart-topic-config.repository';
import type { FetcherRegistry } from '../fetchers/fetcher-registry.service';
import type { ProcessedFeedItemRepository } from '../processed-feed-item.repository';
import type { DigestTaskRepository } from '../digest-task.repository';

import { createListSourcesTool } from './list-sources.tool';
import { createFetchSourceTool } from './fetch-source.tool';
import { createSearchSourceTool } from './search-source.tool';
import { createReadItemFullTool } from './read-item-full.tool';
import { createGetRecentPicksTool } from './get-recent-picks.tool';
import { createSaveFindingTool, type TaskContext } from './save-finding.tool';

export interface DigestToolset {
  list_sources: ReturnType<typeof createListSourcesTool>;
  fetch_source: ReturnType<typeof createFetchSourceTool>;
  search_source: ReturnType<typeof createSearchSourceTool>;
  read_item_full: ReturnType<typeof createReadItemFullTool>;
  get_recent_picks: ReturnType<typeof createGetRecentPicksTool>;
  save_finding: ReturnType<typeof createSaveFindingTool>;
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

  /**
   * 给一次 react-agent loop 创建一组绑定到该 task 的工具。
   *
   * @param taskId — 当前 DigestTask._id，save_finding 写入目标。
   * @returns 6 个工具组成的对象，直接传给 generateText({ tools }) 使用。
   */
  buildToolset(taskId: string): DigestToolset {
    // loop 内共享的 items 缓存，fetch/search 注入，save_finding 反查
    const fetchedItemsMap = new Map<string, FetchedItem>();

    const taskContext: TaskContext = { taskId, fetchedItemsMap };

    // 注入 onItems 回调：fetch/search 成功后把 items 写入 map
    const onItems = (items: FetchedItem[]) => {
      for (const it of items) {
        fetchedItemsMap.set(it.itemGuid, it);
      }
    };

    return {
      list_sources: createListSourcesTool({
        infoSourceRepo: this.infoSourceRepo,
        stcRepo: this.stcRepo,
      }),
      fetch_source: createFetchSourceTool({
        infoSourceRepo: this.infoSourceRepo,
        fetcherRegistry: this.fetcherRegistry,
        onItems,
      }),
      search_source: createSearchSourceTool({
        infoSourceRepo: this.infoSourceRepo,
        fetcherRegistry: this.fetcherRegistry,
        onItems,
      }),
      read_item_full: createReadItemFullTool({
        infoSourceRepo: this.infoSourceRepo,
        fetcherRegistry: this.fetcherRegistry,
      }),
      get_recent_picks: createGetRecentPicksTool({
        pfiRepo: this.pfiRepo,
      }),
      save_finding: createSaveFindingTool({
        taskRepo: this.taskRepo,
        infoSourceRepo: this.infoSourceRepo,
        taskContext,
      }),
    };
  }
}
