import { tool, jsonSchema } from 'ai';
import type { NoteViewService } from '../../workspace/note-view.service';
import { extractHeadings } from './markdown.utils.js';
import { toolResult } from './tool-result';

const DEFAULT_CHUNK = 6000;

/**
 * read_document_content — 读取一篇已发布内容的正文(cat)。
 *
 * 长文不静默丢:从 offset 起返回一段(默认 ~6000 字),outline 永远给全,
 * 超长则 hasMore + nextOffset 让模型自己续读。id 无效 → status:not_found。
 */
export function createReadDocumentContentTool(
  noteViewService: NoteViewService,
) {
  return tool({
    description:
      '读取一篇已发布内容的正文。返回大纲(全)+ 从 offset 起的一段正文(默认约 6000 字)。文档很长时返回会带"还有更多",用 offset 续读。只读已发布内容,当前草稿用 get_current_draft。',
    inputSchema: jsonSchema<{
      contentItemId: string;
      offset?: number;
      limit?: number;
    }>({
      type: 'object',
      properties: {
        contentItemId: {
          type: 'string',
          description: 'contentItemId,从 search/list 的结果中获取',
          examples: ['ci_26869a17d3fc'],
        },
        offset: {
          type: 'number',
          description: '从第几个字符起读,默认 0(续读用上次返回的 nextOffset)',
        },
        limit: { type: 'number', description: '本次最多读多少字,默认 6000' },
      },
      required: ['contentItemId'],
    }),
    execute: async ({
      contentItemId,
      offset = 0,
      limit = DEFAULT_CHUNK,
    }: {
      contentItemId: string;
      offset?: number;
      limit?: number;
    }) => {
      try {
        const doc = await noteViewService.getById(contentItemId);
        const full = doc.bodyMarkdown ?? '';
        const total = full.length;
        const chunk = full.slice(offset, offset + limit);
        const hasMore = offset + limit < total;
        const outline = extractHeadings(full); // 永远给全

        const sizeStr =
          total >= 10000 ? `${(total / 10000).toFixed(1)} 万字` : `${total} 字`;
        // 行内不放"章节":outline.length 是整篇总章节(文档元数据),挂在 partial 读上像"读了 N 章",误导。
        // 行内只留:标题 + 文档大小(字) + 这次读的行号范围。完整大纲在 detail 里给模型。
        const summaryBits = [`《${doc.title}》`, sizeStr];
        // 读了哪几行 —— 按源文件换行计的行号范围(无歧义、可核,不说"开头"、不用模糊的"段")
        const startLine = full.slice(0, offset).split('\n').length;
        const endLine = full.slice(0, offset + chunk.length).split('\n').length;
        summaryBits.push(`读了第 ${startLine}–${endLine} 行`);

        const detail = [
          `# ${doc.title}`,
          outline.length > 0
            ? `大纲:\n${outline.map((h) => `  ${h}`).join('\n')}`
            : '',
          `正文(${offset}–${offset + chunk.length} / 共 ${total}):\n${chunk}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        return toolResult(summaryBits.join(' · '), detail, {
          status: 'ok',
          wordCount: total,
          outlineCount: outline.length,
          offset,
          shown: chunk.length,
          hasMore,
          ...(hasMore ? { nextOffset: offset + limit } : {}),
        });
      } catch {
        return toolResult(
          `无法读取文档(id: ${contentItemId}),请确认 ID`,
          undefined,
          {
            status: 'not_found',
          },
        );
      }
    },
  });
}
