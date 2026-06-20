/**
 * InfoSources API 客户端 — 接 /info-sources CRUD。
 *
 * 信息源是全局共用资源（与 SkillController 同层），跟 skills.ts 同款风格。
 * 首期只支持 type=rss，config.url 必填。
 */
import { request } from './request';

export type InfoSourceType = 'rss' | 'webpage' | 'api' | 'mailbox';

// 分类常量：INFO_SOURCE_CATEGORIES 定义顺序即列表分段展示顺序
export const INFO_SOURCE_CATEGORIES = [
  'ai',
  'tech',
  'business',
  'design',
  'china_tech',
  'reading',
  'academic',
] as const;

export type InfoSourceCategory = typeof INFO_SOURCE_CATEGORIES[number];

export const CATEGORY_LABELS: Record<InfoSourceCategory, string> = {
  ai: 'AI / ML',
  tech: '技术 / 编程',
  business: '商业 / 创业',
  design: '设计 / 产品',
  china_tech: '国内技术',
  reading: '通识 / 思想',
  academic: '学术 / 论文',
};

export interface InfoSource {
  id: string;
  type: InfoSourceType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  category: InfoSourceCategory;
  description?: string | null;
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
  category: InfoSourceCategory;
  description?: string;
}

export interface UpdateInfoSourceInput {
  type?: InfoSourceType;
  name?: string;
  config?: { url: string };
  enabled?: boolean;
  category?: InfoSourceCategory;
  description?: string;
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
