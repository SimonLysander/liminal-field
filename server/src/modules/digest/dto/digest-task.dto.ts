/**
 * DigestTaskDto — 工作流任务状态 API 响应体。
 *
 * 为控制器提供 entity→DTO 转换，隔离内部数据结构与 HTTP 接口。
 * findings 不直接暴露（内容大且仅供内部节点使用），只暴露 findingsCount。
 */

export interface DigestTaskDto {
  id: string;
  topicId: string;
  status: 'running' | 'done' | 'failed';
  traceId: string;
  iterations: number;
  llmCallsCount: number;
  findingsCount: number;
  reportContentItemId: string | null;
  reportSummary: string | null;
  error: string | null;
  startedAt: string; // ISO
  completedAt: string | null;
}
