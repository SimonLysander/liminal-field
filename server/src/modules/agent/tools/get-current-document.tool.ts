import { tool, jsonSchema } from 'ai';
import { extractHeadings } from './markdown.utils.js';

export interface DocumentContext {
  contentItemId: string;
  title: string;
  bodyMarkdown: string;
  /** 前端已提取的标题列表（复用大纲面板逻辑） */
  outline?: string[];
}

/**
 * get_current_draft — 获取当前编辑草稿的画像。
 *
 * 返回结构化画像：标题 + 字数 + 段落数 + 大纲 + 正文（截断至 8000 字）。
 * agent 看到骨架后决定是否需要读正文细节。
 */
export function createGetCurrentDraftTool(
  document: DocumentContext | undefined,
) {
  return tool({
    description:
      '获取当前正在编辑的草稿全文。system prompt 中已有文档画像（标题+字数+大纲），只有需要读正文细节时才调用此工具。',
    parameters: jsonSchema<Record<string, never>>({
      type: 'object',
      properties: {},
    }),
    execute: () => {
      if (!document) return '当前没有打开的草稿';

      const body =
        document.bodyMarkdown.length > 8000
          ? document.bodyMarkdown.slice(0, 8000) + '\n\n[... 内容过长已截断]'
          : document.bodyMarkdown;

      // 如果前端没传 outline，从 markdown 中提取
      const outline =
        document.outline ?? extractHeadings(document.bodyMarkdown);

      // 计算段落数（以空行分隔的非空文本块）
      const paragraphs = document.bodyMarkdown
        .split(/\n\s*\n/)
        .filter((p) => p.trim().length > 0).length;

      return JSON.stringify({
        contentItemId: document.contentItemId,
        title: document.title,
        wordCount: document.bodyMarkdown.length,
        paragraphs,
        outline,
        body,
      });
    },
  });
}
