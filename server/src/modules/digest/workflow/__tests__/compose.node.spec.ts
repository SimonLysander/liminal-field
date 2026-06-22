/**
 * ComposeNode 单测 — 覆盖「分而治之」三阶段契约(plan → 并行 write → assemble)。
 *
 * 重点:
 *   - plan 输出 JSON(headline/deck/topics)→ extractJSON → PlanSchema 校验
 *   - 按 topics 分主题并行 write,每节输出裸 markdown
 *   - assemble 纯代码拼 `## 主题 + 正文`,最终 ComposeSchema 校验
 *   - plan 漏掉的 findings 进兜底主题「其他」
 *
 * 用 jest.mock 拦截 ai 的 generateText——不真打 LLM。
 * mockResolvedValueOnce 按调用顺序喂:第 1 次 = plan,后续 = 各 section(顺序同 topics)。
 */
import { ComposeNode } from '../nodes/compose.node';
import { PromptManagerService } from '../../../../infrastructure/prompt/prompt-manager.service';
import { SystemConfigService } from '../../../settings/system-config.service';
import { generateText } from 'ai';

jest.mock('ai', () => ({
  generateText: jest.fn(),
}));

jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => 'mock-model'),
  })),
}));

const mockGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;

const makeFinding = (citationId: number, title = `篇${citationId}`) => ({
  citationId,
  title,
  sourceName: 'arXiv',
  url: 'http://x',
  reason: 'r',
  snippet: 's',
  fulltext: 'body',
});

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

const planText = (
  headline: string,
  deck: string,
  topics: { title: string; citationIds: number[] }[],
) => ({ text: JSON.stringify({ headline, deck, topics }) }) as never;

describe('ComposeNode (分而治之三阶段)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('plan → 分主题 write → assemble:产出 headline/deck/markdown', async () => {
    mockGenerateText
      .mockResolvedValueOnce(
        planText('H', 'D', [{ title: '主题A', citationIds: [1] }]),
      )
      .mockResolvedValueOnce({ text: '### 篇1\n正文 [@#CIT 1]' } as never);

    const node = makeComposeNode();
    const result = await node.run(makeTask([makeFinding(1)]));

    expect(result.headline).toBe('H');
    expect(result.deck).toBe('D');
    expect(result.markdown).toContain('## 主题A');
    expect(result.markdown).toContain('### 篇1');
    // 1 次 plan + 1 次 section
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it('plan 输出 ```json 包裹 → extractJSON 仍能提取', async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text:
          '```json\n' +
          JSON.stringify({
            headline: 'H2',
            deck: 'D2',
            topics: [{ title: 'T', citationIds: [1] }],
          }) +
          '\n```',
      } as never)
      .mockResolvedValueOnce({ text: '### s\nbody' } as never);

    const node = makeComposeNode();
    const result = await node.run(makeTask([makeFinding(1)]));

    expect(result.headline).toBe('H2');
    expect(result.markdown).toContain('## T');
  });

  it('plan 不符合 PlanSchema(topics 空)→ 抛错', async () => {
    mockGenerateText.mockResolvedValueOnce(planText('H', 'D', []));

    const node = makeComposeNode();
    await expect(node.run(makeTask([makeFinding(1)]))).rejects.toThrow(
      'PlanSchema',
    );
  });

  it('多主题 → 并行写多节,markdown 含全部 ## 标题', async () => {
    mockGenerateText
      .mockResolvedValueOnce(
        planText('H', 'D', [
          { title: 'A', citationIds: [1] },
          { title: 'B', citationIds: [2] },
        ]),
      )
      .mockResolvedValueOnce({ text: '### a\nbody-a' } as never)
      .mockResolvedValueOnce({ text: '### b\nbody-b' } as never);

    const node = makeComposeNode();
    const result = await node.run(makeTask([makeFinding(1), makeFinding(2)]));

    expect(result.markdown).toContain('## A');
    expect(result.markdown).toContain('## B');
    expect(mockGenerateText).toHaveBeenCalledTimes(3); // plan + 2 sections
  });

  it('plan 漏掉的 findings 进兜底主题「其他」', async () => {
    // plan 只覆盖 cit 1,finding 2 未覆盖 → 兜底「其他」节
    mockGenerateText
      .mockResolvedValueOnce(
        planText('H', 'D', [{ title: 'A', citationIds: [1] }]),
      )
      .mockResolvedValueOnce({ text: '### a\nbody-a' } as never)
      .mockResolvedValueOnce({ text: '### other\nbody-other' } as never);

    const node = makeComposeNode();
    const result = await node.run(makeTask([makeFinding(1), makeFinding(2)]));

    expect(result.markdown).toContain('## A');
    expect(result.markdown).toContain('## 其他');
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
  });
});
