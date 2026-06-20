/**
 * DigestTaskRepository 单元测试
 *
 * Mock 风格：同 processed-feed-item.repository.spec.ts — 直接 mock model。
 * 测试覆盖：
 *   1. create() — 写入 status=running findings=[] 的初始记录
 *   2. findById() 存在 → 返回文档
 *   3. findById() 不存在 → null
 *   4. updateStatus() done — $set 字段正确，返回更新后文档
 *   5. updateStatus() failed — error 字段写入
 *   6. appendFindings() — $push $each 调用正确
 */
import { DigestTaskRepository } from './digest-task.repository';
import { DigestTaskStatus } from './digest-task.entity';
import type { DigestTask, Finding } from './digest-task.entity';

// ── Mock Model ─────────────────────────────────────────────────────────────────

const mockModel = {
  create: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateOne: jest.fn(),
} as unknown as jest.Mocked<any>;

function chainExec<T>(val: T) {
  return { exec: jest.fn().mockResolvedValue(val) };
}

// ── Fixture ────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-20T10:00:00.000Z');

function makeTask(overrides: Partial<DigestTask> = {}): DigestTask {
  return {
    _id: 'dt_aabbcc001122',
    topicId: 'ci_topic001',
    status: DigestTaskStatus.running,
    findings: [],
    traceId: 'trace_abc123',
    iterations: 0,
    llmCallsCount: 0,
    startedAt: NOW,
    reportContentItemId: undefined,
    reportSummary: undefined,
    error: undefined,
    completedAt: undefined,
    ...overrides,
  };
}

function makeFinding(citationId: number): Finding {
  return {
    citationId,
    sourceId: 'src_001',
    sourceName: 'Test Feed',
    itemGuid: `guid-${citationId}`,
    title: `Article ${citationId}`,
    url: `https://example.com/${citationId}`,
    snippet: '摘要内容',
    reason: '与事项相关',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('DigestTaskRepository', () => {
  let repo: DigestTaskRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new DigestTaskRepository(mockModel);
  });

  // Case 1: create() — 初始化 running 任务
  it('create() — 写入 status=running findings=[] iterations=0', async () => {
    const task = makeTask();
    mockModel.create.mockResolvedValue(task);

    const result = await repo.create({
      _id: 'dt_aabbcc001122',
      topicId: 'ci_topic001',
      traceId: 'trace_abc123',
      startedAt: NOW,
    });

    expect(mockModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: 'dt_aabbcc001122',
        status: DigestTaskStatus.running,
        findings: [],
        iterations: 0,
        llmCallsCount: 0,
      }),
    );
    expect(result._id).toBe('dt_aabbcc001122');
    expect(result.status).toBe(DigestTaskStatus.running);
  });

  // Case 2: findById() 存在 → 返回文档
  it('findById() — 文档存在时返回 DigestTask', async () => {
    const task = makeTask();
    mockModel.findById.mockReturnValue(chainExec(task));

    const result = await repo.findById('dt_aabbcc001122');

    expect(result).not.toBeNull();
    expect(result!._id).toBe('dt_aabbcc001122');
    expect(result!.topicId).toBe('ci_topic001');
  });

  // Case 3: findById() 不存在 → null
  it('findById() — 文档不存在时返回 null', async () => {
    mockModel.findById.mockReturnValue(chainExec(null));

    const result = await repo.findById('dt_nonexistent');

    expect(result).toBeNull();
  });

  // Case 4: updateStatus() done — $set 字段正确
  it('updateStatus() done — 写入 status/reportContentItemId/completedAt', async () => {
    const completedAt = new Date();
    const updatedTask = makeTask({
      status: DigestTaskStatus.done,
      reportContentItemId: 'ci_report001',
      completedAt,
    });
    mockModel.findByIdAndUpdate.mockReturnValue(chainExec(updatedTask));

    const result = await repo.updateStatus('dt_aabbcc001122', {
      status: DigestTaskStatus.done,
      reportContentItemId: 'ci_report001',
      reportSummary: '本期报告摘要...',
      iterations: 5,
      llmCallsCount: 6,
      completedAt,
    });

    expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
      'dt_aabbcc001122',
      {
        $set: expect.objectContaining({
          status: DigestTaskStatus.done,
          reportContentItemId: 'ci_report001',
          reportSummary: '本期报告摘要...',
          iterations: 5,
          llmCallsCount: 6,
          completedAt,
        }),
      },
      { new: true },
    );
    expect(result!.status).toBe(DigestTaskStatus.done);
  });

  // Case 5: updateStatus() failed — error 字段写入
  it('updateStatus() failed — $set 包含 error 字段', async () => {
    const failedTask = makeTask({
      status: DigestTaskStatus.failed,
      error: 'LLM timeout',
    });
    mockModel.findByIdAndUpdate.mockReturnValue(chainExec(failedTask));

    await repo.updateStatus('dt_aabbcc001122', {
      status: DigestTaskStatus.failed,
      error: 'LLM timeout',
      completedAt: new Date(),
    });

    const call = mockModel.findByIdAndUpdate.mock.calls[0];
    expect(call[1].$set.status).toBe(DigestTaskStatus.failed);
    expect(call[1].$set.error).toBe('LLM timeout');
  });

  // Case 6: appendFindings() — $push $each 调用正确
  it('appendFindings() — 原子追加 findings，调 $push $each', async () => {
    mockModel.updateOne.mockReturnValue(chainExec({ modifiedCount: 1 }));

    const findings = [makeFinding(1), makeFinding(2)];
    await repo.appendFindings('dt_aabbcc001122', findings);

    expect(mockModel.updateOne).toHaveBeenCalledWith(
      { _id: 'dt_aabbcc001122' },
      { $push: { findings: { $each: findings } } },
    );
  });

  // Case 7: appendFindings() 空数组 — 不调 updateOne
  it('appendFindings() 空数组 — 直接返回，不调 updateOne', async () => {
    await repo.appendFindings('dt_aabbcc001122', []);

    expect(mockModel.updateOne).not.toHaveBeenCalled();
  });
});
