import { tool, jsonSchema } from 'ai';
import type { ContentService } from '../../content/content.service';

/**
 * search_knowledge_base — 搜索所有者已发布的知识库内容。
 *
 * 返回值包含 scope 角色标记 + updatedAt，
 * agent 一眼判断相关性，减少二次调用 read_document_content。
 */
export function createSearchKnowledgeBaseTool(contentService: ContentService) {
  return tool({
    description:
      '搜索所有者知识库中已发布的内容（笔记、相册、文集），返回标题、范围、时间和摘要。如需完整正文，用返回的 contentItemId 调用 read_document_content。',
    parameters: jsonSchema<{ query: string; scope?: string }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词，用关键词不要用完整句子',
          examples: ['量子计算', '旅行', '数据可视化'],
        },
        scope: {
          type: 'string',
          enum: ['notes', 'gallery', 'anthology'],
          description: '限定搜索范围，不确定时不传',
        },
      },
      examples: [{ query: '量子计算' }, { query: '旅行', scope: 'gallery' }],
      required: ['query'],
    }),
    execute: async ({ query, scope }: { query: string; scope?: string }) => {
      try {
        const results = await contentService.searchWithScope({
          q: query,
          scope,
          pageSize: 5,
        });
        if (results.length === 0) return '没有找到匹配的内容';

        // 格式化为 agent 友好的文本（带角色标记 + 元数据）
        const lines = results.map((r) => {
          return `[${r.scope}] ${r.title} (${r.updatedAt.slice(0, 10)})\n  ${r.contentItemId}\n  ${r.snippet}`;
        });
        return lines.join('\n\n') + `\n\n共 ${results.length} 条结果`;
      } catch {
        return '搜索失败，请尝试其他关键词';
      }
    },
  });
}
