import { tool, jsonSchema } from 'ai';
import type { ContentService } from '../../content/content.service';
import { ContentVisibility } from '../../content/dto/content-query.dto';
import { toolResult } from './tool-result';

const SCOPE_LABEL: Record<string, string> = {
  notes: '笔记',
  gallery: '相册',
  anthology: '文集',
};

/**
 * list_knowledge_base — 列出已发布内容目录(ls/tree:看有哪些),不含正文。
 *
 * summary 给人(总数 + 类型构成,后端算好),detail 给模型(条目:标题/id/路径),
 * meta 带 byScope/hasMore。与 search(按内容 grep)互补。
 */
export function createListKnowledgeBaseTool(contentService: ContentService) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<{
      scope?: string;
      limit?: number;
      offset?: number;
    }>({
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['notes', 'gallery', 'anthology'],
          description: '限定范围,不传 = 列出全部',
        },
        limit: { type: 'number', description: '返回上限,默认 50' },
        offset: {
          type: 'number',
          description: '从第几条起,默认 0(配合 limit 翻页)',
        },
      },
      examples: [{}, { scope: 'notes' }],
    }),
    execute: async ({
      scope,
      limit = 50,
      offset = 0,
    }: {
      scope?: string;
      limit?: number;
      offset?: number;
    }) => {
      try {
        const page = Math.floor(offset / limit) + 1;
        // 空 query = 列全部;visibility=all 列最新已提交(含未发布)——发布只是对外状态。
        // 多取 1 条判断 hasMore。枚举不需片段 → withSnippet:false(省查询)
        const raw = await contentService.searchWithScope(
          {
            q: '',
            scope,
            page,
            pageSize: limit + 1,
            visibility: ContentVisibility.all,
          },
          { withSnippet: false },
        );
        const hasMore = raw.length > limit;
        const shown = raw.slice(0, limit);

        if (shown.length === 0) {
          return toolResult('知识库还没有内容', undefined, {
            status: 'ok',
            total: 0,
          });
        }

        // 类型构成(后端算)
        const byScope: Record<string, number> = {};
        for (const r of shown) byScope[r.scope] = (byScope[r.scope] ?? 0) + 1;

        // detail 给模型:标题 / id / 路径(不含正文摘要,保持轻量)
        const detail = shown
          .map(
            (r) =>
              `[${r.scope}] ${r.title} · ${r.contentItemId}${r.path ? ` · ${r.path}` : ''}`,
          )
          .join('\n');

        // List = 总览:就一行、没有 ⎿(从 50 篇里采样几个标题对"总览"无意义;要具体篇目去 search)。
        // 行内 = 参数(范围)+ 统计:全部 → 各类型构成 + 总数;指定范围 → 共 N 篇。
        const total = shown.length;
        const more = hasMore ? '+' : '';
        let summary: string;
        if (scope) {
          summary = `${SCOPE_LABEL[scope] ?? scope} · 共 ${total}${more} 篇`;
        } else {
          const parts = Object.entries(byScope).map(
            ([s, c]) => `${SCOPE_LABEL[s] ?? s} ${c}`,
          );
          summary = `全部 · ${parts.join(' · ')} · 共 ${total}${more} 篇`;
        }

        return toolResult(summary, detail, {
          status: 'ok',
          shown: total,
          byScope,
          hasMore,
          ...(hasMore ? { nextOffset: offset + limit } : {}),
        });
      } catch {
        return toolResult('列出内容失败,请稍后再试', undefined, {
          status: 'error',
        });
      }
    },
  });
}
