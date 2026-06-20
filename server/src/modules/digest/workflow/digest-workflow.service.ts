/**
 * DigestWorkflowService — 三节点工作流的编排入口。
 *
 * runOnce(topicId):
 *   1. 校验 topic 存在（SmartTopicConfig）
 *   2. 创建 DigestTask（status=running）
 *   3. 立刻 return { taskId }，**异步**触发 runWorkflow（fire-and-forget）
 *
 * runWorkflow(taskId, topicId)（异步，不阻塞 HTTP）:
 *   1. react_agent.run → findings 累积到 DB
 *   2. findings === 0 → 早停（updateStatus failed）
 *   3. compose.run → { headline, markdown }
 *   4. commit.run → { reportContentItemId }
 *   5. taskRepo.markDone（status=done + reportContentItemId + summary）
 *   任意 throw → taskRepo.updateStatus failed + logger.error
 *
 * 设计决策：
 * - traceId = nanoid(10)，用于跨节点日志关联。
 * - taskId = dt_xxx（同其他业务 id 风格）。
 * - 不直接暴露 runWorkflow，由 runOnce 内部用 void ... .catch() 触发。
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import type { SmartTopicConfigRepository } from '../smart-topic-config.repository';
import type { DigestTaskRepository } from '../digest-task.repository';
import { DigestTaskStatus } from '../digest-task.entity';
import type { ReactAgentNode } from './nodes/react-agent.node';
import type { ComposeNode } from './nodes/compose.node';
import type { CommitNode } from './nodes/commit.node';

function buildTaskId(): string {
  return `dt_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

@Injectable()
export class DigestWorkflowService {
  private readonly logger = new Logger(DigestWorkflowService.name);

  constructor(
    private readonly stcRepo: SmartTopicConfigRepository,
    private readonly taskRepo: DigestTaskRepository,
    private readonly reactAgent: ReactAgentNode,
    private readonly compose: ComposeNode,
    private readonly commit: CommitNode,
  ) {}

  /** 触发一次工作流，立刻返回 taskId，异步执行。 */
  async runOnce(topicId: string): Promise<{ taskId: string }> {
    const config = await this.stcRepo.findByContentItemId(topicId);
    if (!config) {
      throw new NotFoundException(`事项 ${topicId} 不存在或未配置`);
    }

    const taskId = buildTaskId();
    const traceId = nanoid(10);

    await this.taskRepo.create({
      _id: taskId,
      topicId,
      traceId,
      startedAt: new Date(),
    });

    this.logger.log(
      `[workflow] 启动 taskId=${taskId} topicId=${topicId} traceId=${traceId}`,
    );

    // 异步执行，不等待完成
    void this.runWorkflow(taskId, topicId).catch((err: unknown) => {
      this.logger.error(
        `[workflow] runWorkflow 顶层异常 taskId=${taskId}: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    });

    return { taskId };
  }

  /** 执行三节点工作流（异步，内部全量错误处理）。 */
  private async runWorkflow(taskId: string, topicId: string): Promise<void> {
    try {
      // Node 1: react_agent — ReAct loop，findings 写进 DB
      await this.reactAgent.run(taskId, topicId);

      // 读取累积的 findings
      const task = await this.taskRepo.findById(taskId);
      if (!task) {
        this.logger.error(`[workflow] task 不存在 taskId=${taskId}`);
        return;
      }

      if (task.findings.length === 0) {
        this.logger.warn(`[workflow] findings 为 0，早停 taskId=${taskId}`);
        await this.taskRepo.updateStatus(taskId, {
          status: DigestTaskStatus.failed,
          error: '无 findings，工作流提前结束',
          completedAt: new Date(),
        });
        return;
      }

      this.logger.log(
        `[workflow] react_agent 完成 taskId=${taskId} findings=${task.findings.length}`,
      );

      // Node 2: compose — 写报告
      const composeOutput = await this.compose.run(task);

      // Node 3: commit — 入库
      const commitOutput = await this.commit.run(task, composeOutput);

      // 更新 task 为 done
      await this.taskRepo.markDone(
        taskId,
        commitOutput.reportContentItemId,
        composeOutput.markdown.slice(0, 200),
      );

      this.logger.log(
        `[workflow] 完成 taskId=${taskId} reportContentItemId=${commitOutput.reportContentItemId}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[workflow] 失败 taskId=${taskId}: ${msg}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.taskRepo
        .updateStatus(taskId, {
          status: DigestTaskStatus.failed,
          error: msg,
          completedAt: new Date(),
        })
        .catch((updateErr: unknown) => {
          this.logger.error(
            `[workflow] 更新失败状态也失败了 taskId=${taskId}: ${String(updateErr)}`,
          );
        });
    }
  }
}
