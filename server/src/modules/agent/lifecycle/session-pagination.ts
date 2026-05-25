/**
 * session-pagination — 对话历史内存分页纯函数。
 *
 * 将分页算法与 I/O 完全解耦，便于单元测试，无任何 MongoDB / ESM 依赖。
 *
 * 分页游标设计（绝对 index）：
 * - 初始加载（无 before）：返回最近 limit 条（endIdx = total）
 * - 懒加载更早历史（有 before）：返回 before 之前的 limit 条
 * 前端每次加载后持有 firstIndex，下次传 before=firstIndex 即可往前翻页。
 */

export interface SessionPage {
  /** 当前页消息切片（正序：旧→新） */
  messages: Record<string, unknown>[];
  /** 是否还有更早的消息（firstIndex > 0） */
  hasMore: boolean;
  /** 当前页第一条消息的绝对 index（前端下次懒加载传 before=firstIndex） */
  firstIndex: number;
}

/**
 * 对全量消息列表做内存分页切片。
 *
 * @param allMessages 全量消息（正序：旧→新）
 * @param before      游标：取此 index 之前的消息；undefined 时取最近 limit 条
 * @param limit       每页条数
 */
export function sliceSessionPage(
  allMessages: Record<string, unknown>[],
  before: number | undefined,
  limit: number,
): SessionPage {
  const total = allMessages.length;
  // endIdx：这次切片的右界（不含）
  const endIdx = before !== undefined ? Math.min(before, total) : total;
  // startIdx：左界，最小为 0
  const startIdx = Math.max(0, endIdx - limit);

  return {
    messages: allMessages.slice(startIdx, endIdx),
    hasMore: startIdx > 0,
    firstIndex: startIdx,
  };
}
