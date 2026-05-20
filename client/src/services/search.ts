import { request, toQueryString } from './request';

export interface SearchResult {
  contentItemId: string;
  title: string;
  scope: string;
  snippet: string;
  updatedAt: string;
}

export const searchApi = {
  /** @param visibility 管理端传 'all' 以包含未发布内容，展示端不传（默认只搜已发布） */
  query: (q: string, scope?: string, visibility?: string) =>
    request<SearchResult[]>(`/search${toQueryString({ q, scope, visibility })}`),
};
