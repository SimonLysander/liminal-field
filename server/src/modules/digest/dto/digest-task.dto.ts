/**
 * DigestTaskDto — 工作流任务状态 API 响应体。
 *
 * 为控制器提供 entity→DTO 转换，隔离内部数据结构与 HTTP 接口。
 * findings 不直接暴露（内容大且仅供内部节点使用），只暴露 findingsCount。
 *
 * steps 字段：
 *   - 列表端点（GET /digest/topics/:id/tasks）只返 stepsCount，不返 steps 数组（节省 payload）
 *   - 详情端点（GET /digest/tasks/:id）返完整 steps 数组
 */
import type { AgentStep } from '../digest-task.entity';

export interface DigestTaskDto {
  id: string;
  topicId: string;
  status: 'running' | 'done' | 'failed';
  traceId: string;
  iterations: number;
  llmCallsCount: number;
  findingsCount: number;
  /** agent 调用步骤数，列表 + 详情都有 */
  stepsCount: number;
  /** agent 调用链详情，仅详情端点返回（列表端点为 undefined） */
  steps?: AgentStep[];
  reportContentItemId: string | null;
  reportSummary: string | null;
  error: string | null;
  startedAt: string; // ISO
  completedAt: string | null;
}
