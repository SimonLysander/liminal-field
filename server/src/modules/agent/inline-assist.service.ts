import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText } from 'ai';
import { SystemConfigService } from '../settings/system-config.service';
import type { InlineAssistDto } from './dto/inline-assist.dto';

export interface InlineAssistResult {
  markdown: string;
}

const SYSTEM_PROMPT = [
  '你是一个轻量的中文写作补全助手。',
  '你的任务是根据用户要求输出可直接放入正文的 Markdown。',
  '保持原文的语言、语气、格式密度与结构习惯。',
  '如果上下文含有表格、列表、代码块或引用,续写时必须保持合法 Markdown。',
  '不要解释你的思路,不要寒暄,不要包裹 ```markdown 代码围栏。',
  '如果提供了 selected_text,请只输出对 selected_text 处理后的替换文本,不要重复未选中的上下文。',
  '如果没有 selected_text,默认输出 1 到 3 个自然段或等量结构化内容,宁短勿长。',
].join('\n');

function stripOuterMarkdownFence(value: string): string {
  const text = value.trim();
  const match = text.match(
    /^```(?:markdown|md|text|plaintext)?\s*\n([\s\S]*?)\n```$/i,
  );
  return (match ? match[1] : text).trim();
}

function clip(value: string | undefined, max: number): string {
  if (!value) return '';
  return value.length > max ? value.slice(value.length - max) : value;
}

@Injectable()
export class InlineAssistService {
  private readonly logger = new Logger(InlineAssistService.name);

  constructor(private readonly systemConfigService: SystemConfigService) {}

  async assist(dto: InlineAssistDto): Promise<InlineAssistResult> {
    const result = await this.generate(dto);
    return { markdown: stripOuterMarkdownFence(result) };
  }

  async assistStream(dto: InlineAssistDto): Promise<Response> {
    const { model, prompt } = await this.prepare(dto);
    const result = streamText({
      model,
      system: SYSTEM_PROMPT,
      prompt,
      abortSignal: AbortSignal.timeout(60_000),
      onError: ({ error }: { error: unknown }) =>
        this.logger.error(
          'inline assist stream failed',
          error instanceof Error ? error.stack : String(error),
        ),
    });

    return result.toTextStreamResponse({
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  private async generate(dto: InlineAssistDto): Promise<string> {
    const { model, prompt } = await this.prepare(dto);

    try {
      const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt,
        abortSignal: AbortSignal.timeout(60_000),
      });
      return result.text;
    } catch (err) {
      this.logger.error(
        'inline assist failed',
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }

  private async prepare(dto: InlineAssistDto) {
    const beforeText = clip(dto.beforeText, 12_000);
    const selectedText = clip(dto.selectedText, 4_000);
    const afterText = clip(dto.afterText, 4_000);

    if (!beforeText.trim() && !selectedText.trim()) {
      throw new BadRequestException('缺少可续写的上下文');
    }

    const aiConfig = await this.systemConfigService.getAiConfig('flash');
    if (!aiConfig.baseUrl || !aiConfig.apiKey || !aiConfig.model) {
      throw new BadRequestException(
        'AI 配置不完整，请先在设置页配置 API 地址、密钥和模型',
      );
    }

    const provider = createOpenAICompatible({
      name: 'inline-assist',
      baseURL: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
    });

    const prompt = [
      dto.documentTitle ? `文档标题: ${dto.documentTitle}` : '',
      dto.instruction ? `用户补充要求: ${dto.instruction}` : '',
      selectedText ? `<selected_text>\n${selectedText}\n</selected_text>` : '',
      `<before_cursor>\n${beforeText}\n</before_cursor>`,
      afterText ? `<after_cursor>\n${afterText}\n</after_cursor>` : '',
      selectedText
        ? '请只输出用于替换 selected_text 的 Markdown 正文。'
        : '请只输出要插入到光标处的 Markdown 正文。',
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      model: provider.chatModel(aiConfig.model),
      prompt,
    };
  }
}
