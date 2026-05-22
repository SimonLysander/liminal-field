import { tool, jsonSchema } from 'ai';
import type { NoteViewService } from '../../workspace/note-view.service';
import { extractHeadings } from './markdown.utils.js';

/**
 * read_document_content — 读取一篇已发布内容的正文。
 *
 * 返回画像：标题 + 字数 + 大纲 + 正文（截断至 2000 字）。
 * 只读已发布内容，当前草稿用 get_current_draft。
 */
export function createReadDocumentContentTool(
  noteViewService: NoteViewService,
) {
  return tool({
    description:
      '读取一篇已发布内容的完整正文。只读已发布内容，当前草稿用 get_current_draft。正文最多 2000 字。',
    parameters: jsonSchema<{ contentItemId: string }>({
      type: 'object',
      properties: {
        contentItemId: {
          type: 'string',
          description: 'contentItemId，从 search_knowledge_base 的结果中获取',
          examples: ['ci_26869a17d3fc'],
        },
      },
      examples: [{ contentItemId: 'ci_26869a17d3fc' }],
      required: ['contentItemId'],
    }),
    execute: async ({ contentItemId }: { contentItemId: string }) => {
      try {
        // visibility=undefined → 只读已发布内容
        const detail = await noteViewService.getById(contentItemId);
        const body =
          detail.bodyMarkdown.length > 2000
            ? detail.bodyMarkdown.slice(0, 2000) + '\n\n[... 内容过长已截断]'
            : detail.bodyMarkdown;

        // 从 markdown 中提取标题作为大纲
        const outline = extractHeadings(detail.bodyMarkdown);

        return JSON.stringify({
          title: detail.title,
          wordCount: detail.bodyMarkdown.length,
          outline,
          body,
        });
      } catch {
        return `无法读取文档（id: ${contentItemId}），请确认 ID 是否正确`;
      }
    },
  });
}
