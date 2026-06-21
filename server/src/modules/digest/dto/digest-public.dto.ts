/**
 * 公开端报告接口 DTO（无鉴权，任何人可读）。
 * task #52：/digest/topics/:topicId/reports/:reportId 与 /digest/topics/:topicId 端点。
 */

/** 报告里的参考资料条目（来自 DigestTask.findings）。
 * reason / snippet 是 AI 挑选时写入的"为啥选这条"和"原文片段",前端 margin
 * 列表只展示 title+source,但给 Aurora 追问 sub-agent 的 context 里必须带上
 * —— 不然它只看得到标题答不深。 */
export interface PublicFindingDto {
  citationId: number;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  /** AI 挑选时写的事实摘要(为啥这条值得读),~100-200 字 */
  reason?: string;
  /** 原文片段(若 finding 有保存),供 sub-agent 引用具体段落 */
  snippet?: string;
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
    /** 订阅信息源(id + name);Aurora sub-agent 调 browse 工具时从这里看 sourceId */
    sources: { id: string; name: string }[];
  };
  report: {
    id: string;
    headline: string;
    /** 本期 deck:"本期 N 篇:主题 1 / 主题 2 / ..." 目录式概要,标题下方 italic 大字渲染。required */
    deck: string;
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
  /** 栏目宗旨(报纸 standfirst) — admin 配的"栏目宗旨"字段 */
  description: string;
  /** 出刊频率人话(报纸 byline 用),如"每天 08:00" / "每周一 08:00" / "手动触发" */
  cadence?: string;
  /** 订阅信息源数(报纸 byline 用) */
  sourceCount?: number;
  /** 报告列表，按 publishedAt 倒序（最新在前） */
  reports: Array<{
    id: string;
    headline: string;
    summary: string;
    publishedAt: string;
  }>;
}
