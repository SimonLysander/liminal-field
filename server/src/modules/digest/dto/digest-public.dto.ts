/**
 * 公开端报告接口 DTO（无鉴权，任何人可读）。
 * task #52：/digest/topics/:topicId/reports/:reportId 与 /digest/topics/:topicId 端点。
 */

/** 报告里的参考资料条目（来自 DigestTask.findings） */
export interface PublicFindingDto {
  citationId: number;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
}

/** prev/next 导航用的同专栏其他期简要信息 */
export interface PublicSiblingDto {
  id: string;
  headline: string;
  publishedAt: string;
}

/** GET /digest/topics/:topicId/reports/:reportId 返回 */
export interface PublicReportDto {
  topic: {
    id: string;
    name: string;
    description: string;
  };
  report: {
    id: string;
    headline: string;
    /** 报告正文 markdown（从最新 ContentSnapshot 读取） */
    markdown: string;
    findings: PublicFindingDto[];
    publishedAt: string;
  };
  /** 同专栏所有期，按 publishedAt 升序，供前端 prev/next 导航 */
  siblings: PublicSiblingDto[];
}

/** GET /digest/topics/:topicId 返回 */
export interface PublicTopicDto {
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
