/**
 * DigestWorkflowService 单元测试
 *
 * 覆盖：
 *   1. runOnce 立即返回 taskId，异步执行（fire-and-forget）
 *   2. runOnce topic 不存在 → throw NotFoundException
 *   3. findings=0 → updateStatus failed（早停）
 *   4. 完整路径 → markDone 被调用
 *   5. react_agent 失败 → updateStatus failed（兜底）
 */

jest.mock('ai', () => ({
  generateText: jest.fn(),
  generateObject: jest.fn(),
  stepCountIs: jest.fn(() => 'stopWhen'),
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => ({})),
  })),
}));

import { NotFoundException } from '@nestjs/common';
import { DigestWorkflowService } from '../digest-workflow.service';
import { DigestTaskStatus } from '../../digest-task.entity';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { DigestTaskRepository } from '../../digest-task.repository';
import type { ReactAgentNode } from '../nodes/react-agent.node';
import type { ComposeNode } from '../nodes/compose.node';
import type { CommitNode } from '../nodes/commit.node';
import type { DigestTask } from '../../digest-task.entity';
import type { SmartTopicConfig } from '../../smart-topic-config.entity';

function makeStcRepo(
  config: SmartTopicConfig | null,
): SmartTopicConfigRepository {
  return {
    findByContentItemId: jest.fn().mockResolvedValue(config),
  } as unknown as SmartTopicConfigRepository;
}

function makeTaskRepo(
  taskOrNull: DigestTask | null = null,
): DigestTaskRepository {
  return {
    create: jest.fn().mockResolvedValue({ _id: 'dt_test', findings: [] }),
    findById: jest.fn().mockResolvedValue(taskOrNull),
    updateStatus: jest.fn().mockResolvedValue(null),
    markDone: jest.fn().mockResolvedValue(undefined),
    appendFindings: jest.fn().mockResolvedValue(undefined),
  } as unknown as DigestTaskRepository;
}

function makeReactAgent(rejectWith?: Error): ReactAgentNode {
  return {
    run: jest
      .fn()
      .mockImplementation(() =>
        rejectWith ? Promise.reject(rejectWith) : Promise.resolve(),
      ),
  } as unknown as ReactAgentNode;
}

function makeCompose(): ComposeNode {
  return {
    run: jest
      .fn()
      .mockResolvedValue({ headline: '测试标题', markdown: '测试内容' }),
  } as unknown as ComposeNode;
}

function makeCommit(): CommitNode {
  return {
    run: jest.fn().mockResolvedValue({ reportContentItemId: 'ci_report001' }),
  } as unknown as CommitNode;
}

function makeConfig(): SmartTopicConfig {
  return {
    _id: 'stc_001',
    contentItemId: 'ci_topic001',
    cron: '0 8 * * *',
    sourceIds: ['src_001'],
    keywords: [],
    prompt: '测试 prompt',
    enabled: true,
    extractFields: [],
    topN: 10,
    createdAt: new Date(),
  };
}

function makeTask(findingsCount: number): DigestTask {
  return {
    _id: 'dt_test',
    topicId: 'ci_topic001',
    status: DigestTaskStatus.running,
    findings: Array.from({ length: findingsCount }, (_, i) => ({
      citationId: i + 1,
      sourceId: 'src_001',
      sourceName: 'Test Source',
      itemGuid: `guid_${i}`,
      title: `标题 ${i}`,
      url: `https://example.com/${i}`,
      snippet: '摘要',
      reason: '相关',
    })),
    traceId: 'trace_001',
    iterations: 0,
    llmCallsCount: 0,
    startedAt: new Date(),
  };
}

// 等待微任务队列清空（让 fire-and-forget 的 async 完成）
const flushPromises = () => new Promise<void>((r) => setTimeout(r, 10));

describe('DigestWorkflowService', () => {
  it('Case 1: topic 不存在 → throw NotFoundException', async () => {
    const svc = new DigestWorkflowService(
      makeStcRepo(null),
      makeTaskRepo(),
      makeReactAgent(),
      makeCompose(),
      makeCommit(),
    );
    await expect(svc.runOnce('ci_nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('Case 2: runOnce 立即返回 taskId，taskRepo.create 已被调用', async () => {
    const taskRepo = makeTaskRepo(makeTask(0));
    const svc = new DigestWorkflowService(
      makeStcRepo(makeConfig()),
      taskRepo,
      makeReactAgent(),
      makeCompose(),
      makeCommit(),
    );
    const result = await svc.runOnce('ci_topic001');
    expect(result).toHaveProperty('taskId');
    expect(taskRepo.create).toHaveBeenCalledTimes(1);
  });

  it('Case 3: findings=0 → updateStatus failed（早停）', async () => {
    const taskRepo = makeTaskRepo(makeTask(0));
    const svc = new DigestWorkflowService(
      makeStcRepo(makeConfig()),
      taskRepo,
      makeReactAgent(),
      makeCompose(),
      makeCommit(),
    );
    await svc.runOnce('ci_topic001');
    await flushPromises();
    expect(taskRepo.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: DigestTaskStatus.failed }),
    );
    expect(taskRepo.markDone).not.toHaveBeenCalled();
  });

  it('Case 4: findings>0 → markDone 被调用', async () => {
    const taskRepo = makeTaskRepo(makeTask(3));
    const svc = new DigestWorkflowService(
      makeStcRepo(makeConfig()),
      taskRepo,
      makeReactAgent(),
      makeCompose(),
      makeCommit(),
    );
    await svc.runOnce('ci_topic001');
    await flushPromises();
    expect(taskRepo.markDone).toHaveBeenCalledWith(
      expect.any(String),
      'ci_report001',
      expect.any(String),
    );
  });

  it('Case 5: react_agent 失败 → updateStatus failed（兜底）', async () => {
    const taskRepo = makeTaskRepo(makeTask(0));
    const svc = new DigestWorkflowService(
      makeStcRepo(makeConfig()),
      taskRepo,
      makeReactAgent(new Error('LLM timeout')),
      makeCompose(),
      makeCommit(),
    );
    await svc.runOnce('ci_topic001');
    await flushPromises();
    expect(taskRepo.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: DigestTaskStatus.failed,
        error: 'LLM timeout',
      }),
    );
  });
});
