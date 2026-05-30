/**
 * resolved-store —— v3.1 改稿已裁决 callId 的本地持久化。
 *
 * 解决 bug:`tool-propose_document_rewrite` 工具调用一旦完成,永远存在 messages 历史里。
 * 没有"已处理"标记的情况下,`v3ProposalsByCallId` useMemo 每次都会重新算 hunks,
 * 导致:
 *   - 全部接受/拒绝后刷新,又重新进入审批
 *   - 用户在 propose 之间编辑的内容被算成 delete hunk
 *
 * 设计:
 *   - localStorage 全局集合(callId 本身全局唯一,toolCallId 是 AI SDK 生成的)
 *   - 三种时机标 resolved:
 *     1. controller.finalize(所有 hunks 裁决完)
 *     2. 用户发新 prompt(忽略当前 active proposal)
 *     3. computeDocDiff 算出 0 hunks(editor 已等于 newMarkdown)
 *   - 列表 cap 200,防膨胀(更早的 callId 自动淘汰)
 *   - localStorage 不可用时降级(无操作,不抛错)
 *
 * 不存后端:草稿本就 local-first,resolved 标记跟着设备走是可接受的。
 */

const KEY = 'v3-resolved-callids';
const CAP = 200;

function safeRead(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function safeWrite(list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    // cap 200,保留最近的(末尾)
    const trimmed = list.length > CAP ? list.slice(-CAP) : list;
    window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* localStorage quota exceeded / private mode → 降级 */
  }
}

/** 读取当前已 resolved 的 callId 集合(快照,不响应外部变化) */
export function readResolved(): Set<string> {
  return new Set(safeRead());
}

/** 标记某 callId 已裁决。如已存在则忽略(幂等)。 */
export function markResolved(callId: string): void {
  if (!callId) return;
  const list = safeRead();
  if (list.includes(callId)) return;
  list.push(callId);
  safeWrite(list);
}

/** 测试用:清空所有标记。生产代码不应该调。 */
export function __clearAllResolvedForTest(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
