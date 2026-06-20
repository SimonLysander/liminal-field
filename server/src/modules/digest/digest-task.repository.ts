/**
 * DigestTaskRepository — 工作流任务持久化层。
 *
 * 核心能力：
 *   - create()：工作流启动时建任务记录
 *   - findById()：前端轮询 / 节点间传递 task 对象
 *   - updateStatus()：节点完成或失败时更新状态
 *   - appendFindings()：save_finding 工具调用时追加 findings
 *   - findByTopicId()：查某事项所有任务（前端列表 / 调试）
 *
 * id 在调用方（DigestWorkflowService）生成，repository 只做存取。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import {
  AgentStep,
  DigestTask,
  DigestTaskStatus,
  Finding,
} from './digest-task.entity';

export interface CreateDigestTaskInput {
  _id: string;
  topicId: string;
  traceId: string;
  startedAt: Date;
}

export interface UpdateStatusInput {
  status: DigestTaskStatus;
  reportContentItemId?: string;
  reportSummary?: string;
  error?: string;
  iterations?: number;
  llmCallsCount?: number;
  completedAt?: Date;
}

@Injectable()
export class DigestTaskRepository {
  constructor(
    @Inject(getModelToken(DigestTask.name))
    private readonly model: ReturnModelType<typeof DigestTask>,
  ) {}

  /** 工作流启动时建任务记录，status=running，findings=[] */
  async create(input: CreateDigestTaskInput): Promise<DigestTask> {
    return this.model.create({
      ...input,
      status: DigestTaskStatus.running,
      findings: [],
      iterations: 0,
      llmCallsCount: 0,
    });
  }

  async findById(id: string): Promise<DigestTask | null> {
    return this.model.findById(id).exec();
  }

  /** 按事项查所有任务，最新的在前 */
  async findByTopicId(topicId: string): Promise<DigestTask[]> {
    return this.model.find({ topicId }).sort({ startedAt: -1 }).exec();
  }

  /**
   * 更新任务状态（done / failed / 运行中更新统计数据）。
   * 只更新传入的字段，避免覆盖 findings 等并发累积字段。
   */
  async updateStatus(
    id: string,
    patch: UpdateStatusInput,
  ): Promise<DigestTask | null> {
    // 构造 $set 对象，undefined 字段不写入（避免覆盖现有值）
    const $set: Record<string, unknown> = { status: patch.status };
    if (patch.reportContentItemId !== undefined)
      $set.reportContentItemId = patch.reportContentItemId;
    if (patch.reportSummary !== undefined)
      $set.reportSummary = patch.reportSummary;
    if (patch.error !== undefined) $set.error = patch.error;
    if (patch.iterations !== undefined) $set.iterations = patch.iterations;
    if (patch.llmCallsCount !== undefined)
      $set.llmCallsCount = patch.llmCallsCount;
    if (patch.completedAt !== undefined) $set.completedAt = patch.completedAt;

    return this.model.findByIdAndUpdate(id, { $set }, { new: true }).exec();
  }

  /**
   * 追加 findings（pick 工具在 react_agent loop 中调用）。
   * 用 $push 原子追加，不覆盖已有 findings，支持并发 step。
   */
  async appendFindings(id: string, newFindings: Finding[]): Promise<void> {
    if (newFindings.length === 0) return;
    await this.model
      .updateOne({ _id: id }, { $push: { findings: { $each: newFindings } } })
      .exec();
  }

  /**
   * 查某事项最近 N 次 task（最新优先）。
   * Controller GET /digest/topics/:topicId/tasks 调用。
   */
  async findRecentByTopic(
    topicId: string,
    limit: number,
  ): Promise<DigestTask[]> {
    return this.model
      .find({ topicId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * 把一步追加到 task.steps 末尾。原子 $push，不读旧值不覆盖。
   * 用于 react-agent 的 onStepFinish 钩子边跑边写——挂了一半也能看到已跑的步。
   */
  async appendStep(taskId: string, step: AgentStep): Promise<void> {
    await this.model
      .updateOne({ _id: taskId }, { $push: { steps: step } })
      .exec();
  }

  /**
   * 工作流成功完成时调用：写入 status=done + reportContentItemId + reportSummary + completedAt。
   * 与 updateStatus 分开是为了让调用方语义清晰，不必构造完整 patch 对象。
   */
  async markDone(
    id: string,
    reportContentItemId: string,
    summary: string,
  ): Promise<void> {
    await this.model
      .findByIdAndUpdate(id, {
        $set: {
          status: DigestTaskStatus.done,
          reportContentItemId,
          reportSummary: summary,
          completedAt: new Date(),
        },
      })
      .exec();
  }
}
