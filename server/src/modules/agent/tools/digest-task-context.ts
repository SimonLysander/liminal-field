/**
 * DigestTaskContext — browse / pick 工具的运行时状态。
 *
 * 物理位置: agent/tools/(P3 重构后) — 这两个工具不再属于 digest 业务模块,
 * 而是 agent 能力的实现细节,所以 context 类型也跟着挪到 agent/tools/。
 *
 * 字段:
 *   - taskId / topicId: digest workflow 内才有,标识当前在哪个事项的哪一次跑;
 *     report-analyst sub-agent 用 browse 时 taskId 可缺(标 reader 模式)
 *   - refCounter / fetchedItemsMap: browse 写入,pick 读取(共享 state)
 */
import type { FetchedItem } from '../../digest/fetchers/fetcher.interface';

export interface DigestTaskContext {
  /** workflow 内是 dt_xxx;reader 场景为 undefined */
  taskId?: string;
  /** 关联事项 id(ci_xxx) */
  topicId: string;
  /** 工具执行期间的 ref 计数器(i1, i2, ...) */
  refCounter: { item: number };
  /**
   * ref(i1, i2, ...) → { fetchedItem, sourceId, sourceName }。
   * browse 写入,pick 读取;sourceId 是 src_xxx 格式。
   */
  fetchedItemsMap: Map<
    string,
    { fetchedItem: FetchedItem; sourceId: string; sourceName: string }
  >;
  /**
   * url → web_fetch 抓到的原文正文(markdown)。
   * react-agent 在 onStepFinish 拦截 web_fetch 结果写入,pick 时按 fetchedItem.url 取出存进
   * finding.fulltext。这样 agent 不必把原文复制进 pick 参数(省 token、不丢字)。
   * 可选:reader 场景(report-analyst)不收集原文,留空。
   */
  urlToFulltext?: Map<string, string>;
}
