/**
 * DigestWorkflowController — 工作流触发 + 任务状态查询。
 *
 * 路径前缀: @Controller('digest')（拼到 /digest/*）
 * 权限: 全局 JwtAuthGuard 已挂，无 @Public()
 *
 * 端点:
 *   POST  /digest/topics/:topicId/run-now    手动触发 workflow → { taskId }
 *   GET   /digest/tasks/:taskId              查 task 状态 → DigestTaskDto
 *   GET   /digest/topics/:topicId/tasks      列该事项最近 N 次 task（默认 limit=10）
 */
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { DigestWorkflowService } from './workflow/digest-workflow.service';
import { DigestTaskRepository } from './digest-task.repository';
import type { DigestTaskDto } from './dto/digest-task.dto';
import type { DigestTask } from './digest-task.entity';

/** entity → DTO 转换，隔离内部结构与 HTTP 响应 */
function toDto(task: DigestTask): DigestTaskDto {
  return {
    id: String(task._id),
    topicId: task.topicId,
    status: task.status,
    traceId: task.traceId,
    iterations: task.iterations,
    llmCallsCount: task.llmCallsCount,
    findingsCount: task.findings?.length ?? 0,
    reportContentItemId: task.reportContentItemId ?? null,
    reportSummary: task.reportSummary ?? null,
    error: task.error ?? null,
    startedAt: task.startedAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
  };
}

@Controller('digest')
export class DigestWorkflowController {
  private readonly logger = new Logger(DigestWorkflowController.name);

  constructor(
    private readonly workflowService: DigestWorkflowService,
    private readonly taskRepository: DigestTaskRepository,
  ) {}

  /**
   * POST /digest/topics/:topicId/run-now
   * 手动触发一次工作流，立刻返回 taskId（工作流异步执行）。
   */
  @Post('topics/:topicId/run-now')
  @HttpCode(HttpStatus.ACCEPTED)
  async runNow(@Param('topicId') topicId: string): Promise<{ taskId: string }> {
    this.logger.debug(`POST /digest/topics/${topicId}/run-now`);
    return this.workflowService.runOnce(topicId);
  }

  /**
   * GET /digest/tasks/:taskId
   * 查单个 task 状态，前端轮询用。
   */
  @Get('tasks/:taskId')
  async getTask(@Param('taskId') taskId: string): Promise<DigestTaskDto> {
    this.logger.debug(`GET /digest/tasks/${taskId}`);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }
    return toDto(task);
  }

  /**
   * GET /digest/topics/:topicId/tasks
   * 列该事项最近 N 次 task，默认 limit=10。
   */
  @Get('topics/:topicId/tasks')
  async listTasks(
    @Param('topicId') topicId: string,
    @Query('limit') limitStr?: string,
  ): Promise<DigestTaskDto[]> {
    const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 10, 100) : 10;
    this.logger.debug(`GET /digest/topics/${topicId}/tasks limit=${limit}`);
    const tasks = await this.taskRepository.findRecentByTopic(topicId, limit);
    return tasks.map(toDto);
  }
}
