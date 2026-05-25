import { tool, jsonSchema } from 'ai';
import { extractHeadings } from './markdown.utils.js';
import { toolResult } from './tool-result';

const DEFAULT_CHUNK = 6000;

export interface DocumentContext {
  contentItemId: string;
  title: string;
  bodyMarkdown: string;
  /** 前端已提取的标题列表(复用大纲面板逻辑) */
  outline?: string[];
}

/**
 * get_current_draft — 读取当前正在编辑的草稿(与 read_document_content 同策略)。
 *
 * 大纲永远给全 + 从 offset 起一段正文(默认 ~6000 字),长草稿 hasMore 续读。
 * 无草稿 → status:not_found。
 */
export function createGetCurrentDraftTool(
  document: DocumentContext | undefined,
) {
  return tool({
    description:
      '读取当前正在编辑的草稿。返回大纲(全)+ 从 offset 起的一段正文(默认约 6000 字),很长时带"还有更多"用 offset 续读。',
    inputSchema: jsonSchema<{ offset?: number; limit?: number }>({
      type: 'object',
      properties: {
        offset: { type: 'number', description: '从第几个字符起读,默认 0' },
        limit: { type: 'number', description: '本次最多读多少字,默认 6000' },
      },
    }),
    execute: ({
      offset = 0,
      limit = DEFAULT_CHUNK,
    }: {
      offset?: number;
      limit?: number;
    }) => {
      if (!document)
        return toolResult('当前没有打开的草稿', undefined, {
          status: 'not_found',
        });

      const full = document.bodyMarkdown ?? '';
      const total = full.length;
      const chunk = full.slice(offset, offset + limit);
      const hasMore = offset + limit < total;
      const outline = document.outline ?? extractHeadings(full);
      const paragraphs = full
        .split(/\n\s*\n/)
        .filter((p) => p.trim().length > 0).length;

      const sizeStr =
        total >= 10000 ? `${(total / 10000).toFixed(1)} 万字` : `${total} 字`;
      // 行内不放"章节"(整篇总数,挂 partial 读上误导);只留 标题 + 字数 + 读的行号范围。
      const summaryBits = [`《${document.title || '当前草稿'}》`, sizeStr];
      // 读了哪几行 —— 源文件行号范围(无歧义、可核,不说"开头"、不用模糊的"段")
      const startLine = full.slice(0, offset).split('\n').length;
      const endLine = full.slice(0, offset + chunk.length).split('\n').length;
      summaryBits.push(`读了第 ${startLine}–${endLine} 行`);

      const detail = [
        `# ${document.title}`,
        outline.length > 0
          ? `大纲:\n${outline.map((h) => `  ${h}`).join('\n')}`
          : '',
        `正文(${offset}–${offset + chunk.length} / 共 ${total}):\n${chunk}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      return toolResult(summaryBits.join(' · '), detail, {
        status: 'ok',
        contentItemId: document.contentItemId,
        wordCount: total,
        paragraphs,
        outlineCount: outline.length,
        offset,
        shown: chunk.length,
        hasMore,
        ...(hasMore ? { nextOffset: offset + limit } : {}),
      });
    },
  });
}
