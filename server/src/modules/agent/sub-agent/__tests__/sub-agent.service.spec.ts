import { generateText } from 'ai';
import { TOOL_DESCRIPTIONS } from '../../../../prompts/tool-descriptions';
import { SubAgentService } from '../sub-agent.service';

jest.mock('ai', () => {
  const actual = jest.requireActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: jest.fn(),
  };
});

jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => 'mock-model'),
  })),
}));

jest.mock('../../tools/web-search-provider', () => {
  const actual = jest.requireActual<
    typeof import('../../tools/web-search-provider')
  >('../../tools/web-search-provider');
  return {
    ...actual,
    createWebSearchProviderFromEnv: jest.fn(() => ({
      name: 'mock-search',
      search: jest.fn(),
    })),
  };
});

jest.mock('../../tools/web-fetch-provider', () => {
  const actual = jest.requireActual<
    typeof import('../../tools/web-fetch-provider')
  >('../../tools/web-fetch-provider');
  return {
    ...actual,
    createWebFetchProviderFromEnv: jest.fn(() => ({
      name: 'mock-fetch',
      fetch: jest.fn(),
    })),
  };
});

const mockGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;

function createService() {
  return new SubAgentService(
    {
      getAiConfig: jest.fn().mockResolvedValue({
        baseUrl: 'http://model.local',
        apiKey: 'test-key',
        model: 'test-model',
      }),
    } as never,
    {} as never,
    {} as never,
    { emit: jest.fn() } as never,
    { render: jest.fn().mockReturnValue('research-system') } as never,
    {} as never,
    {} as never,
  );
}

describe('SubAgentService', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockGenerateText.mockResolvedValue({ text: '完整研究报告' } as never);
  });

  it('inherits parent context and assembles the complete read-only research toolset', async () => {
    const service = createService();

    await service.execute({
      task: '重点核对定义与来源',
      parentContext: {
        currentUserRequest: '检查这篇学习笔记是否遗漏关键概念',
        recentConversation: '用户：需要面向初学者',
        sceneContext: '当前节点：波动率止损',
        learningNoteId: 'note-1',
      },
    });

    const call = mockGenerateText.mock.calls[0]?.[0] as {
      prompt: string;
      tools: Record<string, { description?: string }>;
    };

    expect(call.prompt).toContain('检查这篇学习笔记是否遗漏关键概念');
    expect(call.prompt).toContain('重点核对定义与来源');
    expect(call.tools).toHaveProperty('search_knowledge_base');
    expect(call.tools).toHaveProperty('read_document_content');
    expect(call.tools).toHaveProperty('read_content');
    expect(call.tools).toHaveProperty('web_search');
    expect(call.tools).toHaveProperty('web_fetch');
    expect(call.tools).not.toHaveProperty('sub_agent');
    expect(call.tools).not.toHaveProperty('write_draft');
    expect(call.tools.web_search.description).toBe(
      TOOL_DESCRIPTIONS.web_search,
    );
  });

  it('does not expose learning-content lookup outside a learning context', async () => {
    const service = createService();

    await service.execute({
      task: '查找相关资料',
      parentContext: { currentUserRequest: '研究这个主题' },
    });

    const call = mockGenerateText.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
    };
    expect(call.tools).not.toHaveProperty('read_content');
  });
});
