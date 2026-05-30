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

// ── 记忆管理（管理端用） ────────────────────────────────

export interface MemoryItem {
  _id: string;
  // 后端 AgentMemoryType 实际是 'user' | 'session',但 session 是草稿级会话脉络
  // (走 sessionMemory + read_conversation_history,不进 UI 管理面板)。
  // UI 只展示 user 记忆。
  type: 'user';
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** 获取所有记忆 */
export function listMemories(): Promise<MemoryItem[]> {
  return request<MemoryItem[]>('/agent/memories');
}

/** 更新记忆（by _id） */
export function updateMemory(
  id: string,
  data: { type?: string; title?: string; content?: string },
): Promise<MemoryItem> {
  return request<MemoryItem>(`/agent/memories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

/** 删除记忆（by _id） */
export function deleteMemory(id: string): Promise<void> {
  return request(`/agent/memories/${id}`, { method: 'DELETE' });
}
