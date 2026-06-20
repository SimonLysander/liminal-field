/**
 * InfoSources API 客户端 — 接 /info-sources CRUD。
 *
 * 信息源是全局共用资源（与 SkillController 同层），跟 skills.ts 同款风格。
 * 首期只支持 type=rss，config.url 必填。
 */
import { request } from './request';

export type InfoSourceType = 'rss' | 'webpage' | 'api' | 'mailbox';

export interface InfoSource {
  id: string;
  type: InfoSourceType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  lastFetchedAt: string | null;
  lastFetchStatus: 'ok' | 'failed' | null;
  lastFetchError: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateInfoSourceInput {
  type: InfoSourceType;
  name: string;
  config: { url: string };
  enabled?: boolean;
}

export interface UpdateInfoSourceInput {
  type?: InfoSourceType;
  name?: string;
  config?: { url: string };
  enabled?: boolean;
}

export const infoSourcesApi = {
  list: () => request<InfoSource[]>('/info-sources'),
  get: (id: string) => request<InfoSource>(`/info-sources/${id}`),
  create: (input: CreateInfoSourceInput) =>
    request<InfoSource>('/info-sources', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateInfoSourceInput) =>
    request<InfoSource>(`/info-sources/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (id: string) =>
    request<void>(`/info-sources/${id}`, { method: 'DELETE' }),
};
