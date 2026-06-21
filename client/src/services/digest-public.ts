/**
 * digest-public.ts — 公开 digest 端 API 客户端（无需登录）。
 *
 * 与 topics.ts（admin CRUD）分离，避免混入 JWT 业务逻辑。
 * task #52：接真实 API，删除 mock 数据依赖。
 */
import { request } from './request';

/** 报告里的参考资料条目。
 * reason / snippet 仅给 Aurora sub-agent context 用(margin 列表不展示);
 * 后端可能不返(老数据),所以可选。 */
export interface PublicFinding {
  citationId: number;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  reason?: string;
  snippet?: string;
}

/** 同专栏其他期（prev/next 导航用） */
export interface PublicSibling {
  id: string;
  headline: string;
  publishedAt: string;
}

/** GET /digest/topics/:topicId/reports/:reportId 响应 */
export interface PublicReportData {
  topic: {
    id: string;
    name: string;
    description: string;
  };
  report: {
    id: string;
    headline: string;
    /** 完整 markdown 正文 */
    markdown: string;
    findings: PublicFinding[];
    publishedAt: string;
  };
  /** 同专栏所有期，按 publishedAt 升序（期号从小到大） */
  siblings: PublicSibling[];
}

/** GET /digest/public/topics/:topicId 响应 */
export interface PublicTopicData {
  id: string;
  name: string;
  description: string;
  /** 报告列表，按 publishedAt 倒序（最新在前） */
  reports: Array<{
    id: string;
    headline: string;
    summary: string;
    publishedAt: string;
  }>;
}

export const digestPublicApi = {
  /**
   * 列出所有公开 digest 事项，供 /digest 目录页使用。
   */
  listTopics: () => request<PublicTopicData[]>('/digest/public/topics'),

  /**
   * 读单个报告（含 topic 信息、findings、siblings）。
   * 公开端不需要鉴权，后端 @Public() 标注。
   */
  getReport: (topicId: string, reportId: string) =>
    request<PublicReportData>(
      `/digest/topics/${topicId}/reports/${reportId}`,
    ),

  /**
   * 读事项基本信息 + 报告列表，供专栏首页使用。
   * 后端路径 /digest/public/topics/:topicId（避免与 admin 路由冲突）。
   */
  getTopic: (topicId: string) =>
    request<PublicTopicData>(`/digest/public/topics/${topicId}`),
};
