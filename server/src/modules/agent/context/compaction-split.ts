import { estimateTokens } from './token-estimate';

export interface SplitOptions {
  window: number; // 模型上下文窗口(token)
  fixedTokens: number; // 固定开销:system + user 记忆 + session 记忆
  triggerRatio: number; // T,如 0.6
  keepRatio: number; // N,如 0.3(N < T)
}

/**
 * 按 token 占比切分对话:决定哪些「最老的」要提炼进记忆(toCompact)、哪些最近原文保留(toKeep)。
 * 关键约束:T(触发)和 N(保留)同标准(都 token 占比),N < T,否则最近原文可能超过触发线导致死锁。
 * 只有总占比 ≥ T 才压缩;压缩后最近原文 token ≤ N*window;保底:至少保留最近 1 条。
 */
export function splitForCompaction(
  messages: Record<string, unknown>[],
  opts: SplitOptions,
): { toCompact: Record<string, unknown>[]; toKeep: Record<string, unknown>[] } {
  const msgTokens = messages.map((m) => estimateTokens(m));
  const total = opts.fixedTokens + msgTokens.reduce((s, t) => s + t, 0);
  if (total <= opts.window * opts.triggerRatio) {
    return { toCompact: [], toKeep: messages };
  }
  const keepBudget = opts.window * opts.keepRatio;
  let acc = 0;
  let splitIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    acc += msgTokens[i];
    if (acc > keepBudget) {
      splitIndex = i + 1;
      break;
    }
    splitIndex = i;
  }
  if (splitIndex >= messages.length && messages.length > 0)
    splitIndex = messages.length - 1; // 保底最近1条
  if (splitIndex < 0) splitIndex = 0;
  return {
    toCompact: messages.slice(0, splitIndex),
    toKeep: messages.slice(splitIndex),
  };
}
