import { BadRequestException } from '@nestjs/common';

import { InlineAssistService } from '../inline-assist.service';
import type { SystemConfigService } from '../../settings/system-config.service';
import type { PromptManagerService } from '../../../infrastructure/prompt/prompt-manager.service';

const mockCompleteText = jest.fn();

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

  const promptManager = {
    render: jest.fn((name: string) => {
      if (name === 'inline-assist/continue-system.md') {
        return '你是一个轻量的中文写作补全助手。';
      }
      throw new Error(`unexpected prompt: ${name}`);
    }),
  } as unknown as PromptManagerService;

  return {
    service: new InlineAssistService(systemConfig, promptManager, {
      completeText: mockCompleteText,
    } as never),
    systemConfig,
    promptManager,
  };
};

describe('InlineAssistService', () => {
  beforeEach(() => {
    mockCompleteText.mockReset();
  });

  it('strips an outer markdown fence from non-streaming output', async () => {
    mockCompleteText.mockResolvedValue({
      text: '```markdown\n## 小节\n正文\n```',
    });

    const { service } = makeService();

    await expect(service.assist({ beforeText: '已有正文' })).resolves.toEqual({
      markdown: '## 小节\n正文',
    });
  });

  it('asks for replacement text only when selectedText is present', async () => {
    mockCompleteText.mockResolvedValue({ text: '更短文本' });

    const { service } = makeService();

    await service.assist({
      beforeText: '前文',
      selectedText: '这是一段很长很长的话',
      instruction: '简写',
    });

    const call = mockCompleteText.mock.calls[0]?.[1] as {
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
    mockCompleteText.mockResolvedValue({ text: '续写内容' });

    const { service } = makeService();

    await service.assist({
      documentMarkdown:
        '# 标题\n\n正文前\n\n<!-- INLINE_ASSIST_CURSOR -->\n\n正文后',
      instruction: '续写',
    });

    const call = mockCompleteText.mock.calls[0]?.[1] as {
      prompt?: string;
    };

    expect(call.prompt).toContain('<document_markdown>');
    expect(call.prompt).toContain('<!-- INLINE_ASSIST_CURSOR -->');
    expect(call.prompt).not.toContain('<before_cursor>');
  });

  it('rejects requests without usable context', async () => {
    const { service } = makeService();

    await expect(service.assist({ beforeText: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockCompleteText).not.toHaveBeenCalled();
  });

  it('rejects incomplete AI config before calling the model', async () => {
    const { service } = makeService({ apiKey: '' });

    await expect(
      service.assist({ beforeText: '上下文' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockCompleteText).not.toHaveBeenCalled();
  });
});
