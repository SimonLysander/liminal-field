import { TOOL_DESCRIPTIONS } from '../../../../prompts/tool-descriptions';
import { SubAgentService } from '../sub-agent.service';

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

const capturedContexts: Array<{
  tools?: Array<{ name: string; description: string }>;
  messages: unknown[];
}> = [];

const model = {
  id: 'test-model',
  name: 'test-model',
  api: 'openai-responses',
  provider: 'test',
  baseUrl: 'http://model.local',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000,
  maxTokens: 4096,
};

function makeAssistantStream(text: string) {
  const message = {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'test',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      yield { type: 'start', partial: message };
      yield { type: 'text_start', contentIndex: 0, partial: message };
      yield {
        type: 'text_delta',
        contentIndex: 0,
        delta: text,
        partial: message,
      };
      yield {
        type: 'text_end',
        contentIndex: 0,
        content: text,
        partial: message,
      };
      yield { type: 'done', reason: 'stop', message };
    },
    result: () => Promise.resolve(message),
  };
}

const streamFn = jest.fn();

function makeFakeAgent(options: any) {
  const listeners: Array<(event: any) => void | Promise<void>> = [];
  const state = { messages: [] as unknown[], errorMessage: undefined };
  return {
    state,
    subscribe(listener: (event: any) => void | Promise<void>) {
      listeners.push(listener);
      return () => undefined;
    },
    abort: jest.fn(),
    async prompt(prompt: string) {
      capturedContexts.push({
        tools: options.initialState.tools,
        messages: [{ role: 'user', content: prompt }],
      });
      const message = (await makeAssistantStream(
        '完整研究报告',
      ).result()) as unknown;
      state.messages.push({ role: 'user', content: prompt }, message);
      for (const listener of listeners) {
        await listener({ type: 'turn_end', message, toolResults: [] });
      }
    },
  };
}

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
    {
      createRuntime: jest.fn().mockResolvedValue({ model, streamFn }),
      createAgent: jest.fn((options) =>
        Promise.resolve(makeFakeAgent(options)),
      ),
    } as never,
  );
}

describe('SubAgentService', () => {
  beforeEach(() => {
    streamFn.mockClear();
    capturedContexts.length = 0;
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

    const context = capturedContexts[0];
    const prompt = (context.messages[0] as { content: string }).content;
    const tools = Object.fromEntries(
      (context.tools ?? []).map((tool) => [tool.name, tool]),
    );

    expect(prompt).toContain('检查这篇学习笔记是否遗漏关键概念');
    expect(prompt).toContain('重点核对定义与来源');
    expect(tools).toHaveProperty('search_knowledge_base');
    expect(tools).toHaveProperty('read_document_content');
    expect(tools).toHaveProperty('read_content');
    expect(tools).toHaveProperty('web_search');
    expect(tools).toHaveProperty('web_fetch');
    expect(tools).not.toHaveProperty('sub_agent');
    expect(tools).not.toHaveProperty('write_draft');
    expect(tools.web_search.description).toBe(TOOL_DESCRIPTIONS.web_search);
  });

  it('does not expose learning-content lookup outside a learning context', async () => {
    const service = createService();

    await service.execute({
      task: '查找相关资料',
      parentContext: { currentUserRequest: '研究这个主题' },
    });

    const toolNames = capturedContexts[0].tools?.map((tool) => tool.name);
    expect(toolNames).not.toContain('read_content');
  });

  it('父运行已经取消时不再启动 Responses 运行', async () => {
    const service = createService();
    const controller = new AbortController();
    controller.abort();

    const result = await service.execute({
      task: '查找相关资料',
      signal: controller.signal,
    });

    expect(JSON.parse(result)).toMatchObject({
      summary: '委派已取消',
      meta: { status: 'error', stepsUsed: 0 },
    });
    expect(capturedContexts).toHaveLength(0);
  });
});
