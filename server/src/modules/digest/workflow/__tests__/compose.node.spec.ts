/**
 * ComposeNode 单测 — 覆盖 compose 节点的核心契约。
 *
 * 重点:
 *   - generateText 输出 JSON → extractJSON 提取 → ComposeSchema 校验 → 返回 ComposeOutput
 *   - 兼容 ```json 代码块包裹
 *   - schema 校验失败抛错(commit 不会拿到非法数据)
 *
 * 用 jest.mock 拦截 ai 的 generateText——不真打 LLM。
 * extractJSON 是真纯函数(agent.utils),不 mock,让它真跑提取逻辑。
 */
import { ComposeNode } from '../nodes/compose.node';
import { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import { SystemConfigService } from '../../../settings/system-config.service';
import { generateText } from 'ai';

// mock ai 模块的 generateText(compose 改用 generateText 走 JSON mode,见 compose.node 注释)
jest.mock('ai', () => ({
  generateText: jest.fn(),
}));

// mock openai-compatible provider:createOpenAICompatible 返回带 chatModel 方法的 provider 对象
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => 'mock-model'),
  })),
}));

const mockGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;

const makeTask = (findings: unknown[]) =>
  ({
    _id: 'dt_test',
    topicId: 'ci_test',
    findings,
  }) as never;

const makeComposeNode = () => {
  const promptManager = {
    render: jest.fn(() => 'rendered-prompt'),
  } as unknown as PromptManagerService;
  const systemConfig = {
    getAiConfig: jest.fn().mockResolvedValue({
      baseUrl: 'http://x',
      apiKey: 'k',
      model: 'deepseek-chat',
    }),
  } as unknown as SystemConfigService;
  return new ComposeNode(promptManager, systemConfig);
};

describe('ComposeNode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generateText 输出纯 JSON → 解析 + 校验通过', async () => {
    mockGenerateText.mockResolvedValue({
      text: '{"headline":"H","deck":"D","markdown":"M"}',
    } as never);

    const node = makeComposeNode();
    const result = await node.run(makeTask([]));

    expect(result).toEqual({ headline: 'H', deck: 'D', markdown: 'M' });
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('generateText 输出 ```json 代码块包裹 → extractJSON 仍能提取', async () => {
    mockGenerateText.mockResolvedValue({
      text: '```json\n{"headline":"H2","deck":"D2","markdown":"M2"}\n```',
    } as never);

    const node = makeComposeNode();
    const result = await node.run(makeTask([]));

    expect(result).toEqual({ headline: 'H2', deck: 'D2', markdown: 'M2' });
  });

  it('输出不符合 ComposeSchema(headline 超 50 字)→ 抛错,挡住非法数据', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        headline: 'x'.repeat(60),
        deck: 'D',
        markdown: 'M',
      }),
    } as never);

    const node = makeComposeNode();
    await expect(node.run(makeTask([]))).rejects.toThrow('ComposeSchema');
  });
});
