import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText } from 'ai';
import { SystemConfigService } from '../settings/system-config.service';
import { PromptManagerService } from '../../infrastructure/prompt/prompt-manager.service';
import type { InlineAssistDto } from './dto/inline-assist.dto';

export interface InlineAssistResult {
  markdown: string;
}

const CONTINUE_SYSTEM_PROMPT = 'inline-assist/continue-system.md';

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

function clipMarkedDocument(value: string | undefined, max: number): string {
  if (!value) return '';
  if (value.length <= max) return value;

  const markers = [
    '<!-- INLINE_ASSIST_CURSOR -->',
    '<!-- INLINE_ASSIST_SELECTION_START -->',
    '<!-- INLINE_ASSIST_SELECTION_END -->',
  ];
  const markerIndexes = markers
    .map((marker) => value.indexOf(marker))
    .filter((index) => index >= 0);
  if (markerIndexes.length === 0) return clip(value, max);

  const markerIndex = Math.min(...markerIndexes);
  const omission = '\n\n<!-- ... document clipped ... -->\n\n';
  const windowSize = Math.max(1_000, max - omission.length * 2);
  const start = Math.max(0, markerIndex - Math.floor(windowSize / 2));
  const end = Math.min(value.length, start + windowSize);
  return [
    start > 0 ? omission.trim() : '',
    value.slice(start, end),
    end < value.length ? omission.trim() : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

@Injectable()
export class InlineAssistService {
  private readonly logger = new Logger(InlineAssistService.name);

  constructor(
    private readonly systemConfigService: SystemConfigService,
    private readonly promptManager: PromptManagerService,
  ) {}

  async assist(dto: InlineAssistDto): Promise<InlineAssistResult> {
    const result = await this.generate(dto);
    return { markdown: stripOuterMarkdownFence(result) };
  }

  async assistStream(dto: InlineAssistDto): Promise<Response> {
    const { model, system, prompt } = await this.prepare(dto);
    const result = streamText({
      model,
      system,
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
    const { model, system, prompt } = await this.prepare(dto);

    try {
      const result = await generateText({
        model,
        system,
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
    const documentMarkdown = clipMarkedDocument(dto.documentMarkdown, 24_000);
    const beforeText = clip(dto.beforeText, 12_000);
    const selectedText = clip(dto.selectedText, 4_000);
    const afterText = clip(dto.afterText, 4_000);

    if (
      !documentMarkdown.trim() &&
      !beforeText.trim() &&
      !selectedText.trim()
    ) {
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

    const system = this.promptManager.render(CONTINUE_SYSTEM_PROMPT);
    const prompt = [
      dto.documentTitle ? `文档标题: ${dto.documentTitle}` : '',
      dto.instruction ? `用户补充要求: ${dto.instruction}` : '',
      documentMarkdown
        ? `<document_markdown>\n${documentMarkdown}\n</document_markdown>`
        : '',
      selectedText ? `<selected_text>\n${selectedText}\n</selected_text>` : '',
      !documentMarkdown && beforeText
        ? `<before_cursor>\n${beforeText}\n</before_cursor>`
        : '',
      !documentMarkdown && afterText
        ? `<after_cursor>\n${afterText}\n</after_cursor>`
        : '',
      documentMarkdown
        ? [
            '文档中的标记说明:',
            '- <!-- INLINE_ASSIST_CURSOR --> 表示插入位置。',
            '- <!-- INLINE_ASSIST_SELECTION_START --> 与 <!-- INLINE_ASSIST_SELECTION_END --> 包住用户选中的文字。',
            '- 光标标记存在时,只输出要插入在标记处的 Markdown 正文。',
            '- 选区标记存在时,只输出用于替换被标记选区的 Markdown 正文。',
          ].join('\n')
        : '',
      selectedText
        ? '请只输出用于替换 selected_text 的 Markdown 正文。'
        : '请只输出要插入到光标处的 Markdown 正文。',
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      model: provider.chatModel(aiConfig.model),
      system,
      prompt,
    };
  }
}
