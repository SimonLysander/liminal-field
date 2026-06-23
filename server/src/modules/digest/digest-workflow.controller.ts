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
  Delete,
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
import { DigestReportRepository } from './digest-report.repository';
import type { DigestTaskDto } from './dto/digest-task.dto';
import type { DigestTask } from './digest-task.entity';

/** 列表端点 entity → DTO（不含 steps 数组，只含 stepsCount，节省 payload） */
function toListDto(task: DigestTask): DigestTaskDto {
  return {
    id: String(task._id),
    topicId: task.topicId,
    status: task.status,
    traceId: task.traceId,
    iterations: task.iterations,
    llmCallsCount: task.llmCallsCount,
    findingsCount: task.findings?.length ?? 0,
    stepsCount: task.steps?.length ?? 0,
    reportContentItemId: task.reportContentItemId ?? null,
    reportSummary: task.reportSummary ?? null,
    error: task.error ?? null,
    startedAt: task.startedAt.toISOString(),
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
  };
}

/** 详情端点 entity → DTO（含完整 steps 数组，供前端展示时间线） */
function toDetailDto(task: DigestTask): DigestTaskDto {
  return {
    ...toListDto(task),
    steps: task.steps ?? [],
  };
}

@Controller('digest')
export class DigestWorkflowController {
  private readonly logger = new Logger(DigestWorkflowController.name);

  constructor(
    private readonly workflowService: DigestWorkflowService,
    private readonly taskRepository: DigestTaskRepository,
    private readonly reportRepository: DigestReportRepository,
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
   * 查单个 task 状态 + 完整 steps（前端详情展开用）。
   */
  @Get('tasks/:taskId')
  async getTask(@Param('taskId') taskId: string): Promise<DigestTaskDto> {
    this.logger.debug(`GET /digest/tasks/${taskId}`);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundException(`Task not found: ${taskId}`);
    }
    return toDetailDto(task);
  }

  /**
   * GET /digest/topics/:topicId/tasks
   * 列该事项最近 N 次 task，默认 limit=10。
   * 不返 steps 数组（只返 stepsCount），节省列表 payload。
   */
  @Get('topics/:topicId/tasks')
  async listTasks(
    @Param('topicId') topicId: string,
    @Query('limit') limitStr?: string,
  ): Promise<DigestTaskDto[]> {
    const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 10, 100) : 10;
    this.logger.debug(`GET /digest/topics/${topicId}/tasks limit=${limit}`);
    const tasks = await this.taskRepository.findRecentByTopic(topicId, limit);
    return tasks.map(toListDto);
  }

  /**
   * DELETE /digest/topics/:topicId/reports/:reportId
   * 删除一期 DigestReport(直接 deleteOne)。task 记录保留作 audit trail。
   *
   * 校验:report 必须属于该 topic,避免跨 topic 误删。
   */
  @Delete('topics/:topicId/reports/:reportId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReport(
    @Param('topicId') topicId: string,
    @Param('reportId') reportId: string,
  ): Promise<void> {
    this.logger.debug(`DELETE /digest/topics/${topicId}/reports/${reportId}`);
    const report = await this.reportRepository.findById(reportId);
    if (!report) {
      throw new NotFoundException(`报告不存在: ${reportId}`);
    }
    if (report.topicId !== topicId) {
      throw new NotFoundException(`报告 ${reportId} 不属于事项 ${topicId}`);
    }
    await this.reportRepository.deleteById(reportId);
    // 级联:清掉所有指向该 report 的 task 的产物引用,避免悬空——
    // 否则删完前端 task 行还显示"删除"钮、再点删已删 report → NotFound(就是这个 bug)
    const cleared = await this.taskRepository.clearReportRef(reportId);
    this.logger.debug(
      `DELETE report ${reportId} 完成,清理 ${cleared} 个 task 的产物引用`,
    );
  }

  /**
   * DELETE /digest/topics/:topicId/tasks/:taskId
   * 删一条运行记录(task)+ 连带删它的产物报告(若有)。失败/成功 task 都能删——
   * 失败 task 没产物只删记录;成功 task 连带把报告一起下架,不留孤立报告。
   *
   * 校验:task 必须属于该 topic,避免跨 topic 误删。
   */
  @Delete('topics/:topicId/tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTask(
    @Param('topicId') topicId: string,
    @Param('taskId') taskId: string,
  ): Promise<void> {
    this.logger.debug(`DELETE /digest/topics/${topicId}/tasks/${taskId}`);
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      throw new NotFoundException(`任务不存在: ${taskId}`);
    }
    if (task.topicId !== topicId) {
      throw new NotFoundException(`任务 ${taskId} 不属于事项 ${topicId}`);
    }
    // 连带删产物报告(若有),避免删了 task 留下孤立报告
    if (task.reportContentItemId) {
      await this.reportRepository.deleteById(task.reportContentItemId);
    }
    await this.taskRepository.deleteById(taskId);
    this.logger.debug(
      `DELETE task ${taskId} 完成(连带 report=${task.reportContentItemId ?? '-'})`,
    );
  }
}
