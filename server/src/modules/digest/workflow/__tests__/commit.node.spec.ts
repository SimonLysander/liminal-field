/**
 * CommitNode 单元测试
 *
 * 覆盖：
 *   1. 正常运行：createContent + create(navNode) + saveContent + pfiRepo.create 均被调用
 *   2. 返回正确的 reportContentItemId
 *   3. findings=0：pfiRepo.create 不调用，流程正常完成
 */

import { CommitNode } from '../nodes/commit.node';
import type { ContentService } from '../../../content/content.service';
import type { NavigationRepository } from '../../../navigation/navigation.repository';
import type { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import type { DigestTask } from '../../digest-task.entity';
import { DigestTaskStatus } from '../../digest-task.entity';
import type { Finding } from '../../digest-task.entity';
import type { ComposeOutput } from '../nodes/compose.node';

function makeContentService(): ContentService {
  return {
    createContent: jest.fn().mockResolvedValue({ id: 'ci_report001' }),
    saveContent: jest.fn().mockResolvedValue({}),
  } as unknown as ContentService;
}

function makeNavRepo(): NavigationRepository {
  return {
    findByContentItemId: jest.fn().mockResolvedValue(null),
    listByParentId: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
  } as unknown as NavigationRepository;
}

function makePfiRepo(): ProcessedFeedItemRepository {
  return {
    create: jest.fn().mockResolvedValue({}),
  } as unknown as ProcessedFeedItemRepository;
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
  markdown: '## 测试\n内容 [CIT 1]',
};

describe('CommitNode', () => {
  it('Case 1: 正常运行 — createContent + saveContent + pfi.create 被调用', async () => {
    const contentService = makeContentService();
    const pfiRepo = makePfiRepo();
    const node = new CommitNode(contentService, makeNavRepo(), pfiRepo);

    const result = await node.run(makeTask([makeFinding(1)]), compose);

    expect(contentService.createContent).toHaveBeenCalledTimes(1);
    expect(contentService.saveContent).toHaveBeenCalledTimes(1);
    expect(pfiRepo.create).toHaveBeenCalledTimes(1);
    expect(result.reportContentItemId).toBe('ci_report001');
  });

  it('Case 2: findings=0 — pfi.create 不调用，流程正常完成', async () => {
    const pfiRepo = makePfiRepo();
    const node = new CommitNode(makeContentService(), makeNavRepo(), pfiRepo);

    const result = await node.run(makeTask([]), compose);

    expect(pfiRepo.create).not.toHaveBeenCalled();
    expect(result.reportContentItemId).toBe('ci_report001');
  });

  it('Case 3: 有 parentNode — listByParentId 用 parentId 调用，navRepo.create 传 parentId', async () => {
    const navRepo = makeNavRepo();
    (navRepo.findByContentItemId as jest.Mock).mockResolvedValue({
      _id: { toString: () => 'nav_parent001' },
    });
    const node = new CommitNode(makeContentService(), navRepo, makePfiRepo());

    await node.run(makeTask([makeFinding(1)]), compose);

    expect(navRepo.listByParentId).toHaveBeenCalledWith(
      'nav_parent001',
      'digest',
    );
    const createCall = (navRepo.create as jest.Mock).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(createCall.parentId).toBe('nav_parent001');
  });
});
