/**
 * ReactAgentNode 单元测试
 *
 * 覆盖：
 *   1. 正常运行：generateText 被调用，传入 system prompt + tools + stopWhen
 *   2. promptManager.render 被调用并带正确的 topic_name / topic_prompt
 */

const mockGenerateText = jest.fn().mockResolvedValue({ steps: [] });
const mockStepCountIs = jest.fn().mockReturnValue('stopWhen');
jest.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  stepCountIs: (...args: unknown[]) => mockStepCountIs(...args),
  NoSuchToolError: class {},
}));
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => ({})),
  })),
}));
jest.mock('../../../agent/agent.utils', () => ({
  makeRepairToolCall: jest.fn(() => jest.fn()),
}));

import { ReactAgentNode } from '../nodes/react-agent.node';
import type { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { ContentRepository } from '../../../content/content.repository';
import type { DigestToolsFactory } from '../../tools/digest-tools.factory';
import type { SystemConfigService } from '../../../settings/system-config.service';
import type { SmartTopicConfig } from '../../smart-topic-config.entity';
import type { ContentItem } from '../../../content/content-item.entity';

function makePromptManager(): PromptManagerService {
  return {
    render: jest.fn().mockReturnValue('mock system prompt'),
  } as unknown as PromptManagerService;
}

function makeStcRepo(
  config: SmartTopicConfig | null,
): SmartTopicConfigRepository {
  return {
    findByContentItemId: jest.fn().mockResolvedValue(config),
  } as unknown as SmartTopicConfigRepository;
}

function makeContentRepo(item: Partial<ContentItem> | null): ContentRepository {
  return {
    findById: jest.fn().mockResolvedValue(item),
  } as unknown as ContentRepository;
}

function makeToolsFactory(): DigestToolsFactory {
  const ctx = {
    taskId: 'dt_test',
    topicId: 'ci_topic001',
    refCounter: { source: 0, item: 0 },
    sourceRefsMap: new Map(),
    fetchedItemsMap: new Map(),
  };
  return {
    createTaskContext: jest.fn().mockReturnValue(ctx),
    buildToolset: jest.fn().mockReturnValue({
      list_sources: {},
      browse: {},
      search: {},
      view: {},
      pick: {},
    }),
  } as unknown as DigestToolsFactory;
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

function makeConfig(): SmartTopicConfig {
  return {
    _id: 'stc_001',
    contentItemId: 'ci_topic001',
    cron: '0 8 * * *',
    sourceIds: [],
    keywords: [],
    prompt: '关注 AI 进展',
    enabled: true,
    extractFields: [],
    topN: 10,
    createdAt: new Date(),
  };
}

describe('ReactAgentNode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Case 1: 正常运行 — generateText 被调用，stopWhen 为 stepCountIs(20)', async () => {
    const node = new ReactAgentNode(
      makePromptManager(),
      makeStcRepo(makeConfig()),
      makeContentRepo({
        latestVersion: {
          title: '测试事项',
          versionId: 'v1',
          commitHash: '',
          summary: '',
        },
      }),
      makeToolsFactory(),
      makeSystemConfig(),
    );

    await node.run('dt_test', 'ci_topic001');

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(mockStepCountIs).toHaveBeenCalledWith(20);
    const callArgs = mockGenerateText.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArgs.stopWhen).toBe('stopWhen');
    expect(callArgs.tools).toBeDefined();
  });

  it('Case 2: promptManager.render 用 topic_name + topic_prompt 调用', async () => {
    const promptManager = makePromptManager();
    const node = new ReactAgentNode(
      promptManager,
      makeStcRepo(makeConfig()),
      makeContentRepo({
        latestVersion: {
          title: '量子计算',
          versionId: 'v1',
          commitHash: '',
          summary: '',
        },
      }),
      makeToolsFactory(),
      makeSystemConfig(),
    );

    await node.run('dt_test', 'ci_topic001');

    expect(promptManager.render).toHaveBeenCalledWith('digest/react-agent.md', {
      topic_name: '量子计算',
      topic_prompt: '关注 AI 进展',
    });
  });
});
