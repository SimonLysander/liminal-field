/**
 * ComposeNode 单元测试
 *
 * 覆盖：
 *   1. 正常运行：generateObject 被调用，返回 { headline, markdown }
 *   2. findings=0：findings_text 包含"无 findings"占位
 */

const mockGenerateObject = jest.fn();
jest.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => ({})),
  })),
}));

import { ComposeNode } from '../nodes/compose.node';
import type { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import type { SystemConfigService } from '../../../settings/system-config.service';
import type { DigestTask } from '../../digest-task.entity';
import { DigestTaskStatus } from '../../digest-task.entity';
import type { Finding } from '../../digest-task.entity';

function makePromptManager(): PromptManagerService {
  return {
    render: jest.fn().mockReturnValue('mock compose prompt'),
  } as unknown as PromptManagerService;
}

function makeSystemConfig(): SystemConfigService {
  return {
    getAiConfig: jest.fn().mockResolvedValue({
      baseUrl: 'https://api.example.com',
      apiKey: 'test-key',
      model: 'test-model',
    }),
  } as unknown as SystemConfigService;
}

function makeFinding(n: number): Finding {
  return {
    citationId: n,
    sourceId: 'src_001',
    sourceName: 'Test Source',
    itemGuid: `guid_${n}`,
    title: `标题 ${n}`,
    url: `https://example.com/${n}`,
    snippet: '摘要内容',
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
    traceId: 'trace_001',
    iterations: 0,
    llmCallsCount: 0,
    startedAt: new Date(),
  };
}

describe('ComposeNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateObject.mockResolvedValue({
      object: { headline: '测试标题', markdown: '## 测试\n内容 [CIT 1]' },
    });
  });

  it('Case 1: 正常运行 — generateObject 被调用，返回 headline + markdown', async () => {
    const node = new ComposeNode(makePromptManager(), makeSystemConfig());
    const result = await node.run(makeTask([makeFinding(1), makeFinding(2)]));

    expect(mockGenerateObject).toHaveBeenCalledTimes(1);
    expect(result.headline).toBe('测试标题');
    expect(result.markdown).toContain('[CIT 1]');
  });

  it('Case 2: findings=0 — promptManager.render 传入包含"无 findings"的 findings_text', async () => {
    const promptManager = makePromptManager();
    const node = new ComposeNode(promptManager, makeSystemConfig());
    await node.run(makeTask([]));

    const renderCall = (promptManager.render as jest.Mock).mock.calls[0];
    expect(renderCall[1].findings_text).toContain('无 findings');
  });
});
