/**
 * ReactAgentNode 单元测试（v5）
 *
 * 覆盖：
 *   1. 正常运行：Pi Agent 收到 system prompt + tools
 *   2. promptManager.render 被调用并带正确的 topic_name / topic_prompt
 *   3. 订阅源列表被拼入 system prompt（infoSourceRepo.findManyByIds 被调用）
 *   4. Pi 工具事件结束时 taskRepository.appendStep 被调用，携带正确的 toolName + args + summary
 *
 * v5 变化：
 *   - ReactAgentNode 新增 taskRepository 依赖（onStepFinish 钩子写 steps）
 */

const capturedContexts: Array<{
  systemPrompt?: string;
  tools?: Array<{ name: string }>;
}> = [];
let nextToolCall: {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
} | null = null;
let toolOutputs: Record<string, unknown> = {};

const model = {
  id: 'test-model',
  name: 'test-model',
  api: 'openai-responses',
  provider: 'test',
  baseUrl: 'https://api.example.com',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000,
  maxTokens: 4096,
};

function makeMessage(content: unknown[], stopReason: 'stop' | 'toolUse') {
  return {
    role: 'assistant',
    content,
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
    stopReason,
    timestamp: Date.now(),
  };
}

function makeStream(message: ReturnType<typeof makeMessage>) {
  return {
    async *[Symbol.asyncIterator]() {
      await Promise.resolve();
      yield { type: 'start', partial: message };
      const toolCall = message.content.find(
        (part: any) => part.type === 'toolCall',
      ) as any;
      if (toolCall) {
        yield { type: 'toolcall_start', contentIndex: 0, partial: message };
        yield {
          type: 'toolcall_end',
          contentIndex: 0,
          toolCall,
          partial: message,
        };
        yield { type: 'done', reason: 'toolUse', message };
      } else {
        yield { type: 'text_start', contentIndex: 0, partial: message };
        yield {
          type: 'text_delta',
          contentIndex: 0,
          delta: '完成',
          partial: message,
        };
        yield {
          type: 'text_end',
          contentIndex: 0,
          content: '完成',
          partial: message,
        };
        yield { type: 'done', reason: 'stop', message };
      }
    },
    result: () => Promise.resolve(message),
  };
}

const mockStreamFn = jest.fn((_model, context) => {
  capturedContexts.push(context);
  if (
    nextToolCall &&
    !context.messages.some((message: any) => message.role === 'toolResult')
  ) {
    return makeStream(
      makeMessage([{ type: 'toolCall', ...nextToolCall }], 'toolUse'),
    );
  }
  return makeStream(makeMessage([{ type: 'text', text: '完成' }], 'stop'));
});

const mockCreateAgent = jest.fn((options: any) => {
  const listeners: Array<(event: any) => void | Promise<void>> = [];
  const state = { messages: [] as unknown[], errorMessage: undefined };
  return Promise.resolve({
    state,
    subscribe(listener: (event: any) => void | Promise<void>) {
      listeners.push(listener);
      return () => undefined;
    },
    abort: jest.fn(),
    async prompt(prompt: string) {
      capturedContexts.push({
        systemPrompt: options.initialState.systemPrompt,
        tools: options.initialState.tools,
      });
      state.messages.push({ role: 'user', content: prompt });
      if (nextToolCall) {
        for (const listener of listeners) {
          await listener({
            type: 'tool_execution_start',
            toolCallId: nextToolCall.id,
            toolName: nextToolCall.name,
            args: nextToolCall.arguments,
          });
        }
        const tool = options.initialState.tools.find(
          (candidate: any) => candidate.name === nextToolCall?.name,
        );
        const result = await tool.execute(
          nextToolCall.id,
          nextToolCall.arguments,
        );
        for (const listener of listeners) {
          await listener({
            type: 'tool_execution_end',
            toolCallId: nextToolCall.id,
            toolName: nextToolCall.name,
            result,
            isError: false,
          });
        }
      }
      const finalMessage = makeMessage(
        [{ type: 'text', text: '完成' }],
        'stop',
      );
      state.messages.push(finalMessage);
      for (const listener of listeners) {
        await listener({
          type: 'turn_end',
          message: finalMessage,
          toolResults: [],
        });
      }
    },
  });
});

function makePiRuntime() {
  return {
    createRuntime: jest
      .fn()
      .mockResolvedValue({ model, streamFn: mockStreamFn }),
    createAgent: mockCreateAgent,
  } as never;
}

import { ReactAgentNode } from '../nodes/react-agent.node';
import type { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import type { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
import type { InfoSourceRepository } from '../../info-source.repository';
import type { ContentRepository } from '../../../content/content.repository';
import type { ToolAssembler } from '../../../agent/lifecycle/tool.assembler';
import type { SystemConfigService } from '../../../settings/system-config.service';
import type { DigestTaskRepository } from '../../digest-task.repository';
import type { DigestReportRepository } from '../../digest-report.repository';
import type { SmartTopicConfig } from '../../smart-topic-config.entity';
import type { ContentItem } from '../../../content/content-item.entity';
import type { InfoSource } from '../../info-source.entity';
import { InfoSourceType, InfoSourceCategory } from '../../info-source.entity';
import { FetcherKind } from '../../fetchers/fetcher.interface';

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

function makeInfoSourceRepo(sources: InfoSource[]): InfoSourceRepository {
  return {
    findManyByIds: jest.fn().mockResolvedValue(sources),
  } as unknown as InfoSourceRepository;
}

function makeContentRepo(item: Partial<ContentItem> | null): ContentRepository {
  return {
    findById: jest.fn().mockResolvedValue(item),
  } as unknown as ContentRepository;
}

function makeToolAssembler(): ToolAssembler {
  const makeTool = (name: string) => ({
    description: name,
    inputSchema: { jsonSchema: { type: 'object', additionalProperties: true } },
    execute: jest.fn(() => Promise.resolve(toolOutputs[name] ?? '')),
  });
  return {
    // P3 重构后:digest workflow 走 agent 的 ToolAssembler.assemble(),拿 4 个工具
    assemble: jest.fn().mockReturnValue({
      browse: makeTool('browse'),
      web_search: makeTool('web_search'),
      web_fetch: makeTool('web_fetch'),
      pick: makeTool('pick'),
    }),
  } as unknown as ToolAssembler;
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

function makeTaskRepository(): jest.Mocked<DigestTaskRepository> {
  return {
    appendStep: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<DigestTaskRepository>;
}

// PR5: react-agent 用 lastReport.publishedAt 算"本期收集窗口"
function makeReportRepo(
  lastPublishedAt?: Date,
): jest.Mocked<DigestReportRepository> {
  return {
    findLatestByTopic: jest
      .fn()
      .mockResolvedValue(
        lastPublishedAt ? { publishedAt: lastPublishedAt } : null,
      ),
  } as unknown as jest.Mocked<DigestReportRepository>;
}

function makeConfig(sourceIds: string[] = []): SmartTopicConfig {
  return {
    _id: 'stc_001',
    contentItemId: 'ci_topic001',
    cron: '0 8 * * *',
    sourceIds,
    keywords: [],
    prompt: '关注 AI 进展',
    enabled: true,
    extractFields: [],
    topN: 10,
    maxSteps: 20,
    createdAt: new Date(),
  };
}

function makeInfoSource(id: string, name: string): InfoSource {
  return {
    _id: id,
    type: InfoSourceType.rss,
    fetcherKind: FetcherKind.rss,
    name,
    config: { url: `https://example.com/${id}.rss` },
    enabled: true,
    category: InfoSourceCategory.engineering,
    createdAt: new Date(),
  };
}

describe('ReactAgentNode (v4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedContexts.length = 0;
    nextToolCall = null;
    toolOutputs = {};
  });

  it('Case 1: 正常运行 — Pi Agent 收到四个工具', async () => {
    const node = new ReactAgentNode(
      makePromptManager(),
      makeStcRepo(makeConfig()),
      makeInfoSourceRepo([]),
      makeContentRepo({
        latestVersion: {
          title: '测试事项',
          versionId: 'v1',
          commitHash: '',
          summary: '',
        },
      }),
      makeToolAssembler(),
      makeSystemConfig(),
      makeTaskRepository(),
      makeReportRepo(),
      makePiRuntime(),
    );

    await node.run('dt_test', 'ci_topic001');

    expect(mockCreateAgent).toHaveBeenCalledTimes(1);
    expect(capturedContexts[0].tools?.map((tool) => tool.name)).toEqual([
      'browse',
      'web_search',
      'web_fetch',
      'pick',
    ]);
  });

  it('Case 2: promptManager.render 用 topic_name + topic_prompt 调用', async () => {
    const promptManager = makePromptManager();
    const node = new ReactAgentNode(
      promptManager,
      makeStcRepo(makeConfig()),
      makeInfoSourceRepo([]),
      makeContentRepo({
        latestVersion: {
          title: '量子计算',
          versionId: 'v1',
          commitHash: '',
          summary: '',
        },
      }),
      makeToolAssembler(),
      makeSystemConfig(),
      makeTaskRepository(),
      makeReportRepo(),
      makePiRuntime(),
    );

    await node.run('dt_test', 'ci_topic001');

    expect(promptManager.render).toHaveBeenCalledWith(
      'digest/react-agent.md',
      expect.objectContaining({
        topic_name: '量子计算',
        topic_prompt: '关注 AI 进展',
        // PR5: react-agent 注入"本期收集窗口"
        since_iso: expect.any(String),
        until_iso: expect.any(String),
      }),
    );
  });

  it('Case 3: 订阅源列表被拼入 system prompt', async () => {
    const sources = [
      makeInfoSource('src_abc123', 'HuggingFace Papers'),
      makeInfoSource('src_def456', 'Hacker News'),
    ];
    const infoSourceRepo = makeInfoSourceRepo(sources);
    const node = new ReactAgentNode(
      makePromptManager(),
      makeStcRepo(makeConfig(['src_abc123', 'src_def456'])),
      infoSourceRepo,
      makeContentRepo({
        latestVersion: {
          title: 'AI 动态',
          versionId: 'v1',
          commitHash: '',
          summary: '',
        },
      }),
      makeToolAssembler(),
      makeSystemConfig(),
      makeTaskRepository(),
      makeReportRepo(),
      makePiRuntime(),
    );

    await node.run('dt_test', 'ci_topic001');

    // infoSourceRepo.findManyByIds 被调用，说明源列表被查询并拼入 prompt
    expect(infoSourceRepo.findManyByIds).toHaveBeenCalledWith([
      'src_abc123',
      'src_def456',
    ]);

    // system prompt 应包含订阅源信息
    expect(capturedContexts[0].systemPrompt).toContain('src_abc123');
    expect(capturedContexts[0].systemPrompt).toContain('HuggingFace Papers');
  });

  it('Case 4: onStepFinish 钩子触发时 taskRepository.appendStep 被调用，携带正确字段', async () => {
    const browseOutput = JSON.stringify({
      summary: 'HuggingFace Papers 过去 7 天 15 条',
      meta: { totalFetched: 30, afterDedupe: 15, status: 'ok' },
    });
    nextToolCall = {
      id: 'tc_001',
      name: 'browse',
      arguments: { sourceId: 'src_abc123', limit: 20 },
    };
    toolOutputs.browse = browseOutput;

    const taskRepo = makeTaskRepository();
    const node = new ReactAgentNode(
      makePromptManager(),
      makeStcRepo(makeConfig()),
      makeInfoSourceRepo([]),
      makeContentRepo({
        latestVersion: {
          title: 'AI 动态',
          versionId: 'v1',
          commitHash: '',
          summary: '',
        },
      }),
      makeToolAssembler(),
      makeSystemConfig(),
      taskRepo,
      makeReportRepo(),
      makePiRuntime(),
    );

    await node.run('dt_test', 'ci_topic001');

    expect(taskRepo.appendStep).toHaveBeenCalledTimes(1);
    const stepArg = (taskRepo.appendStep as jest.Mock).mock.calls[0][1];
    expect(stepArg.toolName).toBe('browse');
    expect(stepArg.args).toEqual({ sourceId: 'src_abc123', limit: 20 });
    expect(stepArg.summary).toBe('HuggingFace Papers 过去 7 天 15 条');
    expect(stepArg.meta).toMatchObject({ totalFetched: 30, afterDedupe: 15 });
    expect(stepArg.error).toBeUndefined();
  });

  it('Case 5: web_fetch step → 原文(detail)按 url 留存进 ctx.urlToFulltext(并 trim)', async () => {
    // web_fetch 返回里 detail 是 markdown 原文;captureFulltext 拦截后按 url 留存,供 pick 关联进 finding.fulltext
    const fetchOutput = JSON.stringify({
      summary: 'web_fetch · https://example.com/a · 1234 字符',
      detail: '# 标题\n这是抓到的原文正文……',
      meta: { status: 'ok', length: 1234 },
    });
    nextToolCall = {
      id: 'tc_f1',
      name: 'web_fetch',
      arguments: { url: '  https://example.com/a  ' },
    };
    toolOutputs.web_fetch = fetchOutput;

    // 捕获 react-agent 内部创建的 digestTaskContext —— urlToFulltext 是其上的内部 state
    let capturedCtx: { urlToFulltext?: Map<string, string> } | undefined;
    const assembler = {
      assemble: jest.fn((deps: { digestTaskContext: typeof capturedCtx }) => {
        capturedCtx = deps.digestTaskContext;
        return makeToolAssembler().assemble({});
      }),
    } as unknown as ToolAssembler;

    const node = new ReactAgentNode(
      makePromptManager(),
      makeStcRepo(makeConfig()),
      makeInfoSourceRepo([]),
      makeContentRepo({
        latestVersion: {
          title: 'AI 动态',
          versionId: 'v1',
          commitHash: '',
          summary: '',
        },
      }),
      assembler,
      makeSystemConfig(),
      makeTaskRepository(),
      makeReportRepo(),
      makePiRuntime(),
    );

    await node.run('dt_test', 'ci_topic001');

    // 留存 key 已 trim,值是 detail 原文
    expect(capturedCtx?.urlToFulltext?.get('https://example.com/a')).toBe(
      '# 标题\n这是抓到的原文正文……',
    );
  });
});
