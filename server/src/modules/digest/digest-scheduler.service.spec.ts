/**
 * DigestSchedulerService 单元测试
 *
 * 覆盖：onModuleInit / registerJob / unregisterJob / reschedule
 * cron 库通过 jest.mock('cron') 整体 mock，避免真实定时器。
 */

// 顶部 mock cron 库，CronJob 构造函数不真正启动定时
jest.mock('cron', () => {
  const mockStart = jest.fn();
  const MockCronJob = jest.fn().mockImplementation(() => ({
    start: mockStart,
  }));
  return { CronJob: MockCronJob };
});

import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { DigestSchedulerService } from './digest-scheduler.service';
import type { SmartTopicConfigRepository } from './smart-topic-config.repository';
import type { DigestWorkflowService } from './workflow/digest-workflow.service';
import type { SmartTopicConfig } from './smart-topic-config.entity';

// ── Mock factories ────────────────────────────────────────────────────────────

function makeConfig(
  overrides: Partial<SmartTopicConfig> = {},
): SmartTopicConfig {
  return {
    _id: 'stc_001',
    contentItemId: 'ci_topic001',
    cron: '0 8 * * *',
    enabled: true,
    sourceIds: [],
    keywords: [],
    prompt: 'test',
    extractFields: [],
    topN: 10,
    maxSteps: 20,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Mock dependencies ─────────────────────────────────────────────────────────

function makeMockRegistry(existingJobs: Map<string, unknown> = new Map()) {
  return {
    getCronJobs: jest.fn().mockReturnValue(existingJobs),
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
  } as unknown as jest.Mocked<SchedulerRegistry>;
}

const mockStcRepo = {
  findEnabled: jest.fn(),
} as unknown as jest.Mocked<SmartTopicConfigRepository>;

const mockWorkflow = {
  runOnce: jest.fn(),
} as unknown as jest.Mocked<DigestWorkflowService>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DigestSchedulerService', () => {
  let service: DigestSchedulerService;
  let mockRegistry: jest.Mocked<SchedulerRegistry>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistry = makeMockRegistry();
    service = new DigestSchedulerService(
      mockRegistry,
      mockStcRepo,
      mockWorkflow,
    );
  });

  // ── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('启动时注册所有 enabled 事项的 cron job', async () => {
      const configs = [
        makeConfig(),
        makeConfig({ contentItemId: 'ci_topic002', _id: 'stc_002' }),
      ];
      mockStcRepo.findEnabled.mockResolvedValue(configs);

      await service.onModuleInit();

      expect(mockStcRepo.findEnabled).toHaveBeenCalledTimes(1);
      // 每个 config 都应建立 CronJob
      expect(CronJob).toHaveBeenCalledTimes(2);
      expect(mockRegistry.addCronJob).toHaveBeenCalledTimes(2);
    });

    it('无 enabled 事项时不注册任何 job', async () => {
      mockStcRepo.findEnabled.mockResolvedValue([]);

      await service.onModuleInit();

      expect(CronJob).not.toHaveBeenCalled();
      expect(mockRegistry.addCronJob).not.toHaveBeenCalled();
    });
  });

  // ── registerJob ───────────────────────────────────────────────────────────

  describe('registerJob()', () => {
    it('注册新 job → addCronJob 被调用，job.start() 被调用', () => {
      const config = makeConfig();

      service.registerJob(config);

      expect(CronJob).toHaveBeenCalledWith(config.cron, expect.any(Function));
      expect(mockRegistry.addCronJob).toHaveBeenCalledWith(
        'digest:ci_topic001',
        expect.any(Object),
      );
      // job.start() 由 mock CronJob 实例的 start 方法追踪

      const mockInstance = (CronJob as unknown as jest.Mock).mock.results[0]
        .value as { start: jest.Mock };
      expect(mockInstance.start).toHaveBeenCalled();
    });

    it('已存在同名 job 时先 deleteCronJob 再重新注册（避免 duplicate）', () => {
      const existingJobs = new Map([['digest:ci_topic001', {}]]);
      mockRegistry = makeMockRegistry(existingJobs);
      service = new DigestSchedulerService(
        mockRegistry,
        mockStcRepo,
        mockWorkflow,
      );

      service.registerJob(makeConfig());

      // 先删除旧的
      expect(mockRegistry.deleteCronJob).toHaveBeenCalledWith(
        'digest:ci_topic001',
      );
      // 再注册新的
      expect(mockRegistry.addCronJob).toHaveBeenCalledWith(
        'digest:ci_topic001',
        expect.any(Object),
      );
    });
  });

  // ── unregisterJob ─────────────────────────────────────────────────────────

  describe('unregisterJob()', () => {
    it('job 存在时调用 deleteCronJob', () => {
      const existingJobs = new Map([['digest:ci_topic001', {}]]);
      mockRegistry = makeMockRegistry(existingJobs);
      service = new DigestSchedulerService(
        mockRegistry,
        mockStcRepo,
        mockWorkflow,
      );

      service.unregisterJob('ci_topic001');

      expect(mockRegistry.deleteCronJob).toHaveBeenCalledWith(
        'digest:ci_topic001',
      );
    });

    it('job 不存在时静默忽略，不报错', () => {
      // registry 默认返回空 Map
      service.unregisterJob('ci_nonexist');

      expect(mockRegistry.deleteCronJob).not.toHaveBeenCalled();
    });
  });

  // ── reschedule ────────────────────────────────────────────────────────────

  describe('reschedule()', () => {
    it('enabled=true → 调用 registerJob（addCronJob 被调用）', () => {
      const config = makeConfig({ enabled: true });

      service.reschedule(config);

      expect(mockRegistry.addCronJob).toHaveBeenCalled();
    });

    it('enabled=false → 调用 unregisterJob，不注册新 job', () => {
      const existingJobs = new Map([['digest:ci_topic001', {}]]);
      mockRegistry = makeMockRegistry(existingJobs);
      service = new DigestSchedulerService(
        mockRegistry,
        mockStcRepo,
        mockWorkflow,
      );

      service.reschedule(makeConfig({ enabled: false }));

      expect(mockRegistry.deleteCronJob).toHaveBeenCalledWith(
        'digest:ci_topic001',
      );
      expect(mockRegistry.addCronJob).not.toHaveBeenCalled();
    });
  });
});
