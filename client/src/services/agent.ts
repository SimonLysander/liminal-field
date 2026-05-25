import { request } from './request';

/** 会话写作计划的一条任务。write_tasks 整体替换,只有 title + status(无 id/依赖) */
export interface SessionTask {
  title: string;
  status: 'pending' | 'in_progress' | 'done';
}

export interface SessionData {
  sessionKey: string;
  messages: Record<string, unknown>[];
  summary: string;
  totalRounds: number;
  tasks: SessionTask[];
  relatedMemories: Array<{ key: string; type: string; title: string; content: string }>;
  lastActiveAt: string | null;
}

/** 加载会话历史。传 title 参数触发 auto-recall（匹配相关 project 记忆）。 */
export function loadSession(sessionKey: string, documentTitle?: string): Promise<SessionData> {
  const params = documentTitle ? `?title=${encodeURIComponent(documentTitle)}` : '';
  return request<SessionData>(`/agent/sessions/${encodeURIComponent(sessionKey)}${params}`);
}

/** 保存会话消息（每次 AI 回复完成后调用），返回最新 tasks */
export function saveSession(
  sessionKey: string,
  messages: Record<string, unknown>[],
): Promise<{ ok: boolean; tasks: SessionTask[] }> {
  return request<{ ok: boolean; tasks: SessionTask[] }>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}`,
    { method: 'PUT', body: JSON.stringify({ messages }) },
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
