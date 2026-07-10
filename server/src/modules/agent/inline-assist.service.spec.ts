import { BadRequestException } from '@nestjs/common';
import { generateText } from 'ai';

import { InlineAssistService } from './inline-assist.service';
import type { SystemConfigService } from '../settings/system-config.service';

jest.mock('ai', () => ({
  generateText: jest.fn(),
  streamText: jest.fn(),
}));

jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => ({
    chatModel: jest.fn(() => 'mock-model'),
  })),
}));

const mockGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;

const makeService = (
  config: Partial<Awaited<ReturnType<SystemConfigService['getAiConfig']>>> = {},
) => {
  const systemConfig = {
    getAiConfig: jest.fn().mockResolvedValue({
      baseUrl: 'http://model.local',
      apiKey: 'test-key',
      model: 'test-model',
      ...config,
    }),
  } as unknown as SystemConfigService;

  return {
    service: new InlineAssistService(systemConfig),
    systemConfig,
  };
};

describe('InlineAssistService', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('strips an outer markdown fence from non-streaming output', async () => {
    mockGenerateText.mockResolvedValue({
      text: '```markdown\n## 小节\n正文\n```',
    } as never);

    const { service } = makeService();

    await expect(service.assist({ beforeText: '已有正文' })).resolves.toEqual({
      markdown: '## 小节\n正文',
    });
  });

  it('asks for replacement text only when selectedText is present', async () => {
    mockGenerateText.mockResolvedValue({ text: '更短文本' } as never);

    const { service } = makeService();

    await service.assist({
      beforeText: '前文',
      selectedText: '这是一段很长很长的话',
      instruction: '简写',
    });

    const call = mockGenerateText.mock.calls[0]?.[0] as {
      prompt?: string;
    };

    expect(call.prompt).toContain('<selected_text>');
    expect(call.prompt).toContain(
      '请只输出用于替换 selected_text 的 Markdown 正文。',
    );
    expect(call.prompt).not.toContain(
      '请只输出要插入到光标处的 Markdown 正文。',
    );
  });

  it('uses marked document markdown instead of fake before cursor context', async () => {
    mockGenerateText.mockResolvedValue({ text: '续写内容' } as never);

    const { service } = makeService();

    await service.assist({
      documentMarkdown:
        '# 标题\n\n正文前\n\n<!-- INLINE_ASSIST_CURSOR -->\n\n正文后',
      instruction: '续写',
    });

    const call = mockGenerateText.mock.calls[0]?.[0] as {
      prompt?: string;
    };

    expect(call.prompt).toContain('<document_markdown>');
    expect(call.prompt).toContain('<!-- INLINE_ASSIST_CURSOR -->');
    expect(call.prompt).not.toContain('<before_cursor>');
  });

  it('builds an illustration planning prompt for selected text', async () => {
    mockGenerateText.mockResolvedValue({
      text: '### 配图构思\n\n适合画: 是',
    } as never);

    const { service } = makeService();

    await service.assist({
      beforeText: '前文',
      mode: 'illustration_plan',
      selectedText: 'Agent 通过工具调用改变外部状态。',
    });

    const call = mockGenerateText.mock.calls[0]?.[0] as {
      prompt?: string;
      system?: string;
    };

    expect(call.system).toContain('图解构思助手');
    expect(call.prompt).toContain(
      '推荐图型: 因果流程图 / 系统架构图 / 概念关系图 / 对比取舍图 / 状态变化图 / 无',
    );
    expect(call.prompt).toContain('生图提示词:');
    expect(call.prompt).toContain('负向提示词:');
    expect(call.prompt).toContain('请只输出上述 Markdown');
    expect(call.prompt).not.toContain(
      '请只输出用于替换 selected_text 的 Markdown 正文。',
    );
  });

  it('requires selected text for illustration planning', async () => {
    const { service } = makeService();

    await expect(
      service.assist({ beforeText: '上下文', mode: 'illustration_plan' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('rejects requests without usable context', async () => {
    const { service } = makeService();

    await expect(service.assist({ beforeText: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it('rejects incomplete AI config before calling the model', async () => {
    const { service } = makeService({ apiKey: '' });

    await expect(
      service.assist({ beforeText: '上下文' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockGenerateText).not.toHaveBeenCalled();
  });
});
