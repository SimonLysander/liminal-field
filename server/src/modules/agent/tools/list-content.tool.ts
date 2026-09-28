import { tool, jsonSchema } from 'ai';
import { BadRequestException, Logger } from '@nestjs/common';
import type { ContentService } from '../../content/content.service';
import { toolResult } from './tool-result';

const SCOPE_LABEL: Record<string, string> = {
  notes: '笔记',
  gallery: '相册',
  anthology: '文集',
};

/**
 * list_knowledge_base — 列出最新已提交内容目录(ls/tree:看有哪些),不含正文。
 *
 * summary 给人(本页条数 + 类型构成),detail 给模型(条目:标题/id/路径),
 * meta 带 byScope/hasMore。与 search(按内容 grep)互补。
 */
export function createListKnowledgeBaseTool(
  contentService: Pick<ContentService, 'listKnowledgeBase'>,
) {
  const logger = new Logger('ListKnowledgeBaseTool');
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
        limit: { type: 'integer', minimum: 1, description: '每页条数,默认 50' },
        offset: {
          type: 'integer',
          minimum: 0,
          description: '在所选范围内跳过的条数,默认 0;续页用返回的 nextOffset',
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
        const { items: shown, hasMore } =
          await contentService.listKnowledgeBase({
            scope,
            limit,
            offset,
          });

        if (shown.length === 0) {
          return toolResult('当前范围本页没有内容', undefined, {
            status: 'ok',
            shown: 0,
            offset,
            hasMore: false,
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

        // shown/byScope 均只统计本页，不能把最后一页或某一页称为全库总数。
        const count = shown.length;
        const more = hasMore ? ' · 还有更多' : '';
        let summary: string;
        if (scope) {
          summary = `${SCOPE_LABEL[scope] ?? scope} · 本页 ${count} 篇${more}`;
        } else {
          const parts = Object.entries(byScope).map(
            ([s, c]) => `${SCOPE_LABEL[s] ?? s} ${c}`,
          );
          summary = `全部 · ${parts.join(' · ')} · 本页 ${count} 篇${more}`;
        }

        return toolResult(summary, detail, {
          status: 'ok',
          shown: count,
          offset,
          byScope,
          hasMore,
          ...(hasMore ? { nextOffset: offset + limit } : {}),
        });
      } catch (cause) {
        const invalid = cause instanceof BadRequestException;
        const context = {
          event: 'knowledge_base_list_failed',
          scope,
          limit,
          offset,
        };
        if (invalid) logger.warn(context);
        else
          logger.error(
            context,
            cause instanceof Error ? cause.stack : String(cause),
          );
        return toolResult(
          invalid ? '目录查询参数无效' : '列出内容失败',
          undefined,
          {
            status: invalid ? 'invalid' : 'error',
          },
        );
      }
    },
  });
}
