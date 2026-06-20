/**
 * topic-view.dto.ts — 事项对外 DTO 定义。
 *
 * TopicSummaryDto: list 轻量视图（不含 sourceIds / keywords / prompt 完整配置）
 * TopicDetailDto: get/create/update 完整视图（含 join InfoSource 名字回显）
 *
 * 风格同 InfoSourceDto（export interface，纯数据，无装饰器）。
 */

export interface TopicSummaryDto {
  /** contentItemId，ci_xxx */
  id: string;
  name: string;
  cron: string;
  sourceCount: number;
  keywordCount: number;
  enabled: boolean;
  /** 该 NavigationNode 下子节点数（报告数，task #36 工作流产出） */
  reportCount: number;
  lastRunAt: string | null;
  /** task #36 才真实填充，此阶段恒为 0 */
  lastRunHits: number;
  lastRunStatus: 'ok' | 'failed' | null;
}

export interface TopicSourceRef {
  id: string;
  name: string;
  type: string;
}

export interface TopicDetailDto {
  /** contentItemId，ci_xxx */
  id: string;
  name: string;
  /** 事项卷首语（bodyMarkdown），可空 */
  description: string;
  cron: string;
  sourceIds: string[];
  /** join InfoSource 后的名字回显 */
  sources: TopicSourceRef[];
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
