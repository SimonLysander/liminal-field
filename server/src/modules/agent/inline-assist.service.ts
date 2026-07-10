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

const ILLUSTRATION_PLAN_PROMPT = [
  '你是一个学习笔记的图解构思助手。',
  '用户不是要你生成图片,而是要你判断选中文本值不值得画,想清楚应该画什么,并给出可复制给生图模型的提示词。',
  '你的输出会显示在配图构思卡片中,默认不写入正文;因此要短、具体、可复制。',
  '优先在这五类图型中选择:因果流程图、系统架构图、概念关系图、对比取舍图、状态变化图。',
  '如果选中文本没有清晰结构关系,要直接判断不适合画,并给出更合适的替代方式。',
  '暂用统一风格:白底或近白底,黑色手绘线条,少量低饱和强调色,类似 Excalidraw 的结构图;少文字,重关系,不做装饰性插画。最终风格以后会单独敲定。',
  '不要假装已经画出了图。',
  '不要寒暄,不要解释你的思路,不要包裹 ```markdown 代码围栏。',
].join('\n');

function getSystemPrompt(mode: InlineAssistDto['mode']): string {
  return mode === 'illustration_plan'
    ? ILLUSTRATION_PLAN_PROMPT
    : SYSTEM_PROMPT;
}

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

  constructor(private readonly systemConfigService: SystemConfigService) {}

  async assist(dto: InlineAssistDto): Promise<InlineAssistResult> {
    const result = await this.generate(dto);
    return { markdown: stripOuterMarkdownFence(result) };
  }

  async assistStream(dto: InlineAssistDto): Promise<Response> {
    const { model, prompt } = await this.prepare(dto);
    const result = streamText({
      model,
      system: getSystemPrompt(dto.mode),
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
        system: getSystemPrompt(dto.mode),
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

    if (dto.mode === 'illustration_plan' && !selectedText.trim()) {
      throw new BadRequestException('请先选中需要构思配图的文字');
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

    const prompt =
      dto.mode === 'illustration_plan'
        ? [
            dto.documentTitle ? `文档标题: ${dto.documentTitle}` : '',
            dto.instruction ? `用户补充要求: ${dto.instruction}` : '',
            documentMarkdown
              ? `<document_markdown>\n${documentMarkdown}\n</document_markdown>`
              : '',
            `<selected_text>\n${selectedText}\n</selected_text>`,
            documentMarkdown
              ? [
                  '文档中的标记说明:',
                  '- <!-- INLINE_ASSIST_SELECTION_START --> 与 <!-- INLINE_ASSIST_SELECTION_END --> 包住用户选中的文字。',
                  '- 只围绕被标记的选区构思图解,其余正文只作为语境。',
                ].join('\n')
              : '',
            '<output_format>',
            '### 配图构思',
            '',
            '适合画: 是 / 否 / 可选',
            '',
            '图要解决的问题:',
            '- 用一句话说明这张图要让读者一眼看懂什么;如果不适合画,说明原因。',
            '',
            '推荐图型: 因果流程图 / 系统架构图 / 概念关系图 / 对比取舍图 / 状态变化图 / 无',
            '',
            '画面构思:',
            '- 如果适合,列出 3 到 6 个节点、箭头、分组或布局要点;说明画面从左到右或从上到下如何组织。',
            '- 如果不适合,写"不建议画图"。',
            '',
            '标签草案:',
            '- 只列短标签,避免长中文句子。',
            '',
            '生图提示词:',
            '```text',
            '用英文写一段可直接复制给生图模型的 prompt。包含图型、布局、节点、关系、临时统一风格。不要生成正文解释。',
            '```',
            '',
            '负向提示词:',
            '```text',
            '用英文列出要避免的内容,如 photorealistic, 3D, ornate background, dense text, long Chinese sentences, decorative icons。',
            '```',
            '</output_format>',
            '请只输出上述 Markdown,不要输出 selected_text 原文。',
          ]
            .filter(Boolean)
            .join('\n\n')
        : [
            dto.documentTitle ? `文档标题: ${dto.documentTitle}` : '',
            dto.instruction ? `用户补充要求: ${dto.instruction}` : '',
            documentMarkdown
              ? `<document_markdown>\n${documentMarkdown}\n</document_markdown>`
              : '',
            selectedText
              ? `<selected_text>\n${selectedText}\n</selected_text>`
              : '',
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
      prompt,
    };
  }
}
