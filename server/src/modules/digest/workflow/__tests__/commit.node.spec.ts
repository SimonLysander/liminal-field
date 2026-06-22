/**
 * CommitNode 单元测试(重构后:写 DigestReport,不再走 ContentItem/NavNode)
 *
 * 覆盖:
 *   1. 正常运行:digestReportRepo.upsertByPeriod 调用 + pfi.create × findings.length
 *   2. findings=0:pfi.create 不调用,流程正常完成
 *   3. reportId 用 dr_ 前缀(来自 upsertByPeriod 返回文档的 _id)
 *   4. DigestReport upsert 入参完整(headline / markdown / findings / topicId / taskId / publishedAt / periodKey)
 */

import { CommitNode } from '../nodes/commit.node';
import type { DigestReportRepository } from '../../digest-report.repository';
import type { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { DigestTask } from '../../digest-task.entity';
import { DigestTaskStatus } from '../../digest-task.entity';
import type { Finding } from '../../digest-task.entity';
import type { ComposeOutput } from '../nodes/compose.node';

function makeReportRepo(): DigestReportRepository {
  return {
    upsertByPeriod: jest.fn().mockResolvedValue({ _id: 'dr_mockreportid' }),
  } as unknown as DigestReportRepository;
}

function makePfiRepo(): ProcessedFeedItemRepository {
  return {
    create: jest.fn().mockResolvedValue({}),
  } as unknown as ProcessedFeedItemRepository;
}

function makeStcRepo(cron?: string): SmartTopicConfigRepository {
  return {
    findByContentItemId: jest.fn().mockResolvedValue(cron ? { cron } : null),
  } as unknown as SmartTopicConfigRepository;
}

function makeFinding(n: number): Finding {
  return {
    citationId: n,
    sourceId: 'src_001',
    sourceName: 'Test Source',
    itemGuid: `guid_${n}`,
    title: `标题 ${n}`,
    url: `https://example.com/${n}`,
    snippet: '摘要',
    reason: '相关',
    publishedAt: new Date('2026-06-01'),
  };
}

function makeTask(findings: Finding[]): DigestTask {
  return {
    _id: 'dt_test',
    topicId: 'ci_topic001',
    status: DigestTaskStatus.running,
    findings,
    steps: [],
    traceId: 'trace_001',
    iterations: 0,
    llmCallsCount: 0,
    startedAt: new Date(),
  };
}

const compose: ComposeOutput = {
  headline: '测试标题',
  deck: '本期 1 篇:测试主题',
  markdown: '## 测试\n内容 [CIT 1]',
};

describe('CommitNode', () => {
  it('Case 1: 正常运行 — digestReportRepo.upsertByPeriod + pfi.create 都调用', async () => {
    const reportRepo = makeReportRepo();
    const pfiRepo = makePfiRepo();
    const node = new CommitNode(reportRepo, pfiRepo, makeStcRepo());

    const result = await node.run(makeTask([makeFinding(1)]), compose);

    expect(reportRepo.upsertByPeriod).toHaveBeenCalledTimes(1);
    expect(pfiRepo.create).toHaveBeenCalledTimes(1);
    expect(result.reportContentItemId).toBe('dr_mockreportid');
  });

  it('Case 2: findings=0 — pfi.create 不调用,DigestReport 仍然写入', async () => {
    const reportRepo = makeReportRepo();
    const pfiRepo = makePfiRepo();
    const node = new CommitNode(reportRepo, pfiRepo, makeStcRepo());

    const result = await node.run(makeTask([]), compose);

    expect(reportRepo.upsertByPeriod).toHaveBeenCalledTimes(1);
    expect(pfiRepo.create).not.toHaveBeenCalled();
    expect(result.reportContentItemId).toBe('dr_mockreportid');
  });

  it('Case 3: DigestReport upsert 入参完整(headline / markdown / findings / topicId / taskId / publishedAt / periodKey)', async () => {
    const reportRepo = makeReportRepo();
    // 传入日刊 cron,验证 periodKey 有正确日期格式
    const node = new CommitNode(
      reportRepo,
      makePfiRepo(),
      makeStcRepo('0 8 * * *'),
    );

    const findings = [makeFinding(1), makeFinding(2)];
    await node.run(makeTask(findings), compose);

    const upsertInput = (reportRepo.upsertByPeriod as jest.Mock).mock
      .calls[0][0] as {
      _id: string;
      topicId: string;
      taskId: string;
      headline: string;
      markdown: string;
      findings: Finding[];
      publishedAt: Date;
      periodKey: string;
    };
    expect(upsertInput._id).toMatch(/^dr_[a-f0-9]+$/);
    expect(upsertInput.topicId).toBe('ci_topic001');
    expect(upsertInput.taskId).toBe('dt_test');
    expect(upsertInput.headline).toBe('测试标题');
    expect(upsertInput.markdown).toBe(compose.markdown);
    expect(upsertInput.findings).toHaveLength(2);
    expect(upsertInput.publishedAt).toBeInstanceOf(Date);
    // periodKey 应为 YYYY-MM-DD 格式
    expect(upsertInput.periodKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
