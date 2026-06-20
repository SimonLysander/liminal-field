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
}

export interface UpdateTopicInput {
  name?: string;
  description?: string;
  cron?: string;
  sourceIds?: string[];
  keywords?: string[];
  prompt?: string;
  enabled?: boolean;
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
