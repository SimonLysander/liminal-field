/**
 * topics.ts — 智能采集事项 API 客户端，接 /digest/topics CRUD。
 *
 * 风格同 info-sources.ts（request + 类型定义）。
 */
import { request } from './request';
import type { InfoSource } from './info-sources';

export interface TopicSummary {
  id: string;
  name: string;
  cron: string;
  sourceCount: number;
  keywordCount: number;
  enabled: boolean;
  reportCount: number;
  lastRunAt: string | null;
  lastRunHits: number;
  lastRunStatus: 'ok' | 'failed' | null;
}

export interface TopicDetail {
  id: string;
  name: string;
  description: string;
  cron: string;
  sourceIds: string[];
  sources: Pick<InfoSource, 'id' | 'name' | 'type'>[];
  keywords: string[];
  prompt: string;
  enabled: boolean;
  /** Agent 最大轮次，默认 20，范围 5-50 */
  maxSteps?: number;
  reportCount: number;
  lastRunAt: string | null;
  lastRunStatus: 'ok' | 'failed' | null;
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateTopicInput {
  name: string;
  description?: string;
  cron: string;
  sourceIds: string[];
  keywords: string[];
  prompt: string;
  enabled?: boolean;
  maxSteps?: number;
}

export interface UpdateTopicInput {
  name?: string;
  description?: string;
  cron?: string;
  sourceIds?: string[];
  keywords?: string[];
  prompt?: string;
  enabled?: boolean;
  maxSteps?: number;
}

export const topicsApi = {
  list: () => request<TopicSummary[]>('/digest/topics'),
  get: (id: string) => request<TopicDetail>(`/digest/topics/${id}`),
  create: (input: CreateTopicInput) =>
    request<TopicDetail>('/digest/topics', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateTopicInput) =>
    request<TopicDetail>(`/digest/topics/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (id: string) =>
    request<void>(`/digest/topics/${id}`, { method: 'DELETE' }),
};

// ── Digest Task API ───────────────────────────────────────────────────────────

/** 列表端点返回（不含 steps 数组） */
export interface DigestTaskListItem {
  id: string;
  topicId: string;
  status: 'running' | 'done' | 'failed';
  traceId: string;
  iterations: number;
  llmCallsCount: number;
  findingsCount: number;
  stepsCount: number;
  reportContentItemId: string | null;
  reportSummary: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

/** Agent 调用链中的一步（tool_call + 结果摘要） */
export interface AgentStep {
  ts: string;
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  meta?: Record<string, number | string>;
  durationMs: number;
  error?: string;
}

/** 详情端点返回（含完整 steps） */
export interface DigestTaskDetail extends DigestTaskListItem {
  steps: AgentStep[];
}

export const digestTasksApi = {
  listByTopic: (topicId: string, limit = 5) =>
    request<DigestTaskListItem[]>(
      `/digest/topics/${topicId}/tasks?limit=${limit}`,
    ),
  get: (taskId: string) => request<DigestTaskDetail>(`/digest/tasks/${taskId}`),
  runNow: (topicId: string) =>
    request<{ taskId: string }>(`/digest/topics/${topicId}/run-now`, {
      method: 'POST',
    }),
  /** 删除一期报告。Phase 1 重构:走专用端点,不再走 structureApi.deleteNode。 */
  deleteReport: (topicId: string, reportId: string) =>
    request<void>(`/digest/topics/${topicId}/reports/${reportId}`, {
      method: 'DELETE',
    }),
  /** 删一次运行(task)+ 连带产物报告。失败/成功 task 都可删。 */
  deleteTask: (topicId: string, taskId: string) =>
    request<void>(`/digest/topics/${topicId}/tasks/${taskId}`, {
      method: 'DELETE',
    }),
};
