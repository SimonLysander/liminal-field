/**
 * DigestWorkflowController 单元测试
 *
 * 覆盖三个端点的正常路径 + 错误路径。
 * Mock 风格：直接 new Controller(mockDeps)，不走 NestJS 测试模块。
 */
import { NotFoundException } from '@nestjs/common';
import { DigestWorkflowController } from './digest-workflow.controller';
import type { DigestWorkflowService } from './workflow/digest-workflow.service';
import type { DigestTaskRepository } from './digest-task.repository';
import type { DigestReportRepository } from './digest-report.repository';
import type { DigestTask } from './digest-task.entity';
import { DigestTaskStatus } from './digest-task.entity';

// ── Mock factories ────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-20T10:00:00.000Z');

function makeTask(overrides: Partial<DigestTask> = {}): DigestTask {
  return {
    _id: 'dt_aabbcc001122',
    topicId: 'ci_topic001',
    status: DigestTaskStatus.done,
    traceId: 'trace_abc01',
    iterations: 3,
    llmCallsCount: 4,
    findings: [{ citationId: 1 } as DigestTask['findings'][0]],
    steps: [],
    reportContentItemId: 'ci_report001',
    reportSummary: 'AI 摘要',
    error: undefined,
    startedAt: NOW,
    completedAt: NOW,
    ...overrides,
  };
}

// ── Mock services ─────────────────────────────────────────────────────────────

const mockWorkflowService = {
  runOnce: jest.fn(),
} as unknown as jest.Mocked<DigestWorkflowService>;

const mockTaskRepository = {
  findById: jest.fn(),
  findRecentByTopic: jest.fn(),
  clearReportRef: jest.fn(),
} as unknown as jest.Mocked<DigestTaskRepository>;

const mockReportRepository = {
  findById: jest.fn(),
  deleteById: jest.fn(),
} as unknown as jest.Mocked<DigestReportRepository>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DigestWorkflowController', () => {
  let controller: DigestWorkflowController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DigestWorkflowController(
      mockWorkflowService,
      mockTaskRepository,
      mockReportRepository,
    );
  });

  // ── POST /digest/topics/:topicId/run-now ──────────────────────────────────

  describe('runNow()', () => {
    it('调用 workflowService.runOnce 并返回 { taskId }', async () => {
      mockWorkflowService.runOnce.mockResolvedValue({
        taskId: 'dt_aabbcc001122',
      });

      const result = await controller.runNow('ci_topic001');

      expect(mockWorkflowService.runOnce).toHaveBeenCalledWith('ci_topic001');
      expect(result).toEqual({ taskId: 'dt_aabbcc001122' });
    });

    it('事项不存在时 NotFoundException 从 service 透传', async () => {
      mockWorkflowService.runOnce.mockRejectedValue(
        new NotFoundException('事项不存在'),
      );

      await expect(controller.runNow('ci_nonexist')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── GET /digest/tasks/:taskId ─────────────────────────────────────────────

  describe('getTask()', () => {
    it('找到 task → 返回 DigestTaskDto，字段映射正确', async () => {
      mockTaskRepository.findById.mockResolvedValue(makeTask());

      const result = await controller.getTask('dt_aabbcc001122');

      expect(mockTaskRepository.findById).toHaveBeenCalledWith(
        'dt_aabbcc001122',
      );
      expect(result.id).toBe('dt_aabbcc001122');
      expect(result.topicId).toBe('ci_topic001');
      expect(result.status).toBe('done');
      expect(result.findingsCount).toBe(1);
      expect(result.reportContentItemId).toBe('ci_report001');
      expect(result.error).toBeNull();
      expect(result.startedAt).toBe(NOW.toISOString());
      expect(result.completedAt).toBe(NOW.toISOString());
    });

    it('task 不存在 → NotFoundException', async () => {
      mockTaskRepository.findById.mockResolvedValue(null);

      await expect(controller.getTask('dt_nonexist')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── GET /digest/topics/:topicId/tasks ────────────────────────────────────

  describe('listTasks()', () => {
    it('返回最近 N 次 task 的 DTO 数组，默认 limit=10', async () => {
      mockTaskRepository.findRecentByTopic.mockResolvedValue([makeTask()]);

      const result = await controller.listTasks('ci_topic001');

      expect(mockTaskRepository.findRecentByTopic).toHaveBeenCalledWith(
        'ci_topic001',
        10,
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('dt_aabbcc001122');
    });

    it('传 limit=5 时使用指定 limit', async () => {
      mockTaskRepository.findRecentByTopic.mockResolvedValue([]);

      await controller.listTasks('ci_topic001', '5');

      expect(mockTaskRepository.findRecentByTopic).toHaveBeenCalledWith(
        'ci_topic001',
        5,
      );
    });

    it('limit 超过 100 时截断为 100', async () => {
      mockTaskRepository.findRecentByTopic.mockResolvedValue([]);

      await controller.listTasks('ci_topic001', '999');

      expect(mockTaskRepository.findRecentByTopic).toHaveBeenCalledWith(
        'ci_topic001',
        100,
      );
    });

    it('limit 非数字时降级为 10', async () => {
      mockTaskRepository.findRecentByTopic.mockResolvedValue([]);

      await controller.listTasks('ci_topic001', 'abc');

      expect(mockTaskRepository.findRecentByTopic).toHaveBeenCalledWith(
        'ci_topic001',
        10,
      );
    });
  });

  // ── DELETE /digest/topics/:topicId/reports/:reportId ─────────────────────
  describe('deleteReport()', () => {
    it('report 存在且属于 topic → 删 report + 级联清 task 产物引用', async () => {
      mockReportRepository.findById.mockResolvedValue({
        _id: 'dr_x',
        topicId: 'ci_topic001',
      } as never);
      mockTaskRepository.clearReportRef.mockResolvedValue(2);

      await controller.deleteReport('ci_topic001', 'dr_x');

      expect(mockReportRepository.deleteById).toHaveBeenCalledWith('dr_x');
      // 关键:级联清掉指向该 report 的 task 引用(否则前端再删报 NotFound 的 bug)
      expect(mockTaskRepository.clearReportRef).toHaveBeenCalledWith('dr_x');
    });

    it('report 不存在 → NotFound,不删不清', async () => {
      mockReportRepository.findById.mockResolvedValue(null);

      await expect(
        controller.deleteReport('ci_topic001', 'dr_x'),
      ).rejects.toThrow(NotFoundException);
      expect(mockReportRepository.deleteById).not.toHaveBeenCalled();
      expect(mockTaskRepository.clearReportRef).not.toHaveBeenCalled();
    });

    it('report 不属于该 topic → NotFound(防跨 topic 误删)', async () => {
      mockReportRepository.findById.mockResolvedValue({
        _id: 'dr_x',
        topicId: 'ci_other',
      } as never);

      await expect(
        controller.deleteReport('ci_topic001', 'dr_x'),
      ).rejects.toThrow(NotFoundException);
      expect(mockReportRepository.deleteById).not.toHaveBeenCalled();
    });
  });
});
