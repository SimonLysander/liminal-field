/**
 * MemoryAgentService.compact 行为契约测试(新架构:只提炼记忆,不产 summary)。
 *
 * 锁定:
 * - compact 产物落地:session 记忆 content(upsertSession) + 每条 user 记忆(upsert)
 * - 返回 { memoriesExtracted },不再返回 summary
 * - LLM 产烂数据时降级:不抛、返回 0,不污染记忆
 *
 * 不打真 LLM——mock 掉 ai 的 generateText,直接喂构造好的 JSON 文本。
 */
import { generateText } from 'ai';
import { MemoryAgentService } from './memory-agent.service';

// mock ai 的 generateText:compact 内部用它调 LLM
jest.mock('ai', () => ({
  generateText: jest.fn(),
}));
// createOpenAICompatible 在 getModel 里被调,返回一个能 .chatModel() 的桩
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => ({})),
  })),
}));

const mockedGenerateText = generateText as unknown as jest.Mock;

describe('MemoryAgentService.compact', () => {
  let service: MemoryAgentService;
  let memoryRepo: {
    findByTypes: jest.Mock;
    upsertSession: jest.Mock;
    upsert: jest.Mock;
  };
  let systemConfig: { getAiConfig: jest.Mock };

  beforeEach(() => {
    mockedGenerateText.mockReset();
    memoryRepo = {
      findByTypes: jest.fn().mockResolvedValue([]),
      upsertSession: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    systemConfig = {
      getAiConfig: jest.fn().mockResolvedValue({
        baseUrl: 'http://x',
        apiKey: 'k',
        model: 'm',
        aiSystemPrompt: '',
        contextWindow: 32000,
      }),
    };
    // MemoryAgentService 现在需要 PromptManagerService(第三个参数)
    // compact 里调 this.promptManager.render('memory/session-compactor.md',...)
    // mock render 直接返回 inputText(保留动态内容让 generateText mock 正常工作)
    const mockPromptManager = {
      render(_name: string, vars: Record<string, string> = {}): string {
        // session-compactor.md 的 {{input_text}} 占位替换即可
        return vars['input_text'] ?? '';
      },
    } as never;
    service = new MemoryAgentService(
      memoryRepo as never,
      systemConfig as never,
      mockPromptManager,
    );
  });

  it('LLM 产 {sessionContent, userMemories}:写 session 记忆 + 每条 user 记忆', async () => {
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify({
        sessionContent: '用户想打磨开篇,结论是改用倒叙',
        userMemories: [
          { title: '写作偏好', content: '偏好倒叙开篇' },
          { title: '语气', content: '克制冷静' },
        ],
      }),
    });

    const res = await service.compact(
      'draft-1',
      [{ role: 'user', content: '开篇怎么改' }],
      '之前的脉络',
    );

    // session 记忆 content 被覆盖写入(by agentKey)
    expect(memoryRepo.upsertSession).toHaveBeenCalledWith(
      'draft-1',
      '用户想打磨开篇,结论是改用倒叙',
    );
    // 两条 user 记忆 upsert
    expect(memoryRepo.upsert).toHaveBeenCalledTimes(2);
    expect(memoryRepo.upsert).toHaveBeenCalledWith({
      type: 'user',
      title: '写作偏好',
      content: '偏好倒叙开篇',
    });
    // 返回提炼条数,不含 summary
    expect(res).toEqual({ memoriesExtracted: 2 });
    expect(res).not.toHaveProperty('summary');
  });

  it('userMemories 为空:只写 session 记忆,不写 user 记忆', async () => {
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify({ sessionContent: '只有脉络', userMemories: [] }),
    });

    const res = await service.compact('draft-2', [], '');

    expect(memoryRepo.upsertSession).toHaveBeenCalledWith(
      'draft-2',
      '只有脉络',
    );
    expect(memoryRepo.upsert).not.toHaveBeenCalled();
    expect(res).toEqual({ memoriesExtracted: 0 });
  });

  it('LLM 产烂数据(非 JSON):降级返回 0,不抛、不写记忆', async () => {
    mockedGenerateText.mockResolvedValue({ text: '这不是 JSON' });

    const res = await service.compact('draft-3', [], '');

    expect(res).toEqual({ memoriesExtracted: 0 });
    expect(memoryRepo.upsertSession).not.toHaveBeenCalled();
    expect(memoryRepo.upsert).not.toHaveBeenCalled();
  });
});
