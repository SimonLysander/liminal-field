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
 * - relatedMemories：U6 起恒为空数组，保留字段兼容前端结构，前端不使用
 */
export interface SessionData {
  sessionKey: string;
  messages: Record<string, unknown>[];
  hasMore: boolean;
  firstIndex: number;
  summary: string;
  tasks: SessionTask[];
  relatedMemories: never[];
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
  opts?: { before?: number; limit?: number },
): Promise<SessionData> {
  const params = new URLSearchParams();
  if (opts?.before !== undefined) params.set('before', String(opts.before));
  if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request<SessionData>(`/agent/sessions/${encodeURIComponent(sessionKey)}${qs}`);
}

/**
 * 保存会话消息（每次 AI 回复完成后调用），返回最新 tasks。
 *
 * 后端 onAfterChat 是纯 append 语义（appendMessages），
 * 因此前端只发本轮新增消息（方案 A），避免全量重发导致重复追加。
 * 调用方需自行维护已保存的消息游标（savedCountRef），截取 messages.slice(savedCount)。
 */
export function saveSession(
  sessionKey: string,
  newMessages: Record<string, unknown>[],
): Promise<{ ok: boolean; tasks: SessionTask[] }> {
  return request<{ ok: boolean; tasks: SessionTask[] }>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}`,
    { method: 'PUT', body: JSON.stringify({ messages: newMessages }) },
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
  type: 'user' | 'project';
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
