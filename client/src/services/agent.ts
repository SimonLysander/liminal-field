import { request } from './request';

/** 会话写作计划的一条任务。write_tasks 整体替换,只有 title + status(无 id/依赖) */
export interface SessionTask {
  title: string;
  status: 'pending' | 'in_progress' | 'done';
}

/**
 * 后端分页响应结构（U5 聚合分页 endpoint）。
 *
 * - messages：本页消息切片（正序：旧→新）
 * - hasMore：是否还有更早的历史（前端据此决定是否显示"加载更多"触发区）
 * - firstIndex：当前页第一条消息的绝对 index，下次懒加载传 before=firstIndex
 * - summary：session 记忆 content（由 compaction 提炼的对话脉络，后端注入 system prompt）
 * - tasks：session 记忆中的写作计划
 *
 * 注:relatedMemories 字段已于 #150(2026-05-31) 彻底删除——自动召回已废,
 * 模型主动调 recall_memory / search_memories 按需读
 */
export interface SessionData {
  sessionKey: string;
  messages: Record<string, unknown>[];
  hasMore: boolean;
  firstIndex: number;
  summary: string;
  tasks: SessionTask[];
  lastActiveAt: string | null;
}

export interface BusinessSessionSummary {
  sessionKey: string;
  title: string;
  messageCount: number;
  lastActiveAt: string | null;
}

/**
 * 加载会话历史（支持分页）。
 *
 * - 不传 before/limit：取最近 limit 条（初始加载，最新一页）
 * - 传 before：取 before index 之前的 limit 条（懒加载更早历史）
 * 游标语义与后端 sliceSessionPage 保持一致：before 是绝对 index。
 */
export function loadSession(
  sessionKey: string,
  opts?: { agentInstanceKey?: string; before?: number; limit?: number },
): Promise<SessionData> {
  const params = new URLSearchParams();
  if (opts?.agentInstanceKey) params.set('agentInstanceKey', opts.agentInstanceKey);
  if (opts?.before !== undefined) params.set('before', String(opts.before));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<SessionData>(`/agent/sessions/${encodeURIComponent(sessionKey)}${qs}`);
}

export function listBusinessSessions(
  agentInstanceKey: string,
): Promise<BusinessSessionSummary[]> {
  return request<BusinessSessionSummary[]>(
    `/agent/session-groups/${encodeURIComponent(agentInstanceKey)}/sessions`,
  );
}

export function renameBusinessSession(
  sessionKey: string,
  title: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}/title`,
    { method: 'PATCH', body: JSON.stringify({ title }) },
  );
}

/** 删除会话（清空对话） */
export function deleteSession(sessionKey: string): Promise<void> {
  return request(`/agent/sessions/${encodeURIComponent(sessionKey)}`, {
    method: 'DELETE',
  });
}

// ── 记忆管理(2026-05-30 event log) ────────────────────────

/**
 * 单条观察(agent_memory_observations 表里一行)。
 * append-only 岁月史书,前端只读、不可编辑/删除。
 */
export type ObservationTopic =
  | 'identity'
  | 'personality'
  | 'aesthetic'
  | 'method'
  | 'other';

export interface ObservationItem {
  _id: string;
  observedAt: string;
  topic: ObservationTopic;
  observation: string;
  context?: string;
  sessionKey?: string;
}

export interface ObservationsResponse {
  observations: ObservationItem[];
  currentView: { markdown: string; derivedAt: string } | null;
}

/** 取岁月史书 + 当前画像(管理端用) */
export function listObservations(): Promise<ObservationsResponse> {
  return request<ObservationsResponse>('/agent/observations');
}

// ── HITL 写工具门禁(2026-06 learning-hitl) ──────────────────────────────────

/**
 * 批准一次被门禁的写工具调用,后端真正落库。
 * 门禁工具:write_draft / write_learn_plan / write_tasks / remember。
 */
export function approveWrite(
  toolCallId: string,
  sessionKey: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/agent/writes/${encodeURIComponent(toolCallId)}/approve`,
    { method: 'POST', body: JSON.stringify({ sessionKey }) },
  );
}

/** 拒绝一次被门禁的写工具调用,后端丢弃。 */
export function rejectWrite(
  toolCallId: string,
  sessionKey: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/agent/writes/${encodeURIComponent(toolCallId)}/reject`,
    { method: 'POST', body: JSON.stringify({ sessionKey }) },
  );
}
