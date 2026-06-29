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
 * search_knowledge_base — 搜索所有者已发布的知识库内容(grep:按内容找)。
 *
 * 返回统一 ToolResult:summary 给人(命中数 + 头几个标题),detail 给模型(命中列表),
 * meta 带 total/hasMore(命中超 limit 不静默丢,让模型可换更准的词)。
 */
export function createSearchKnowledgeBaseTool(contentService: ContentService) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<{ query: string; scope?: string; limit?: number }>({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词,用关键词不要用完整句子',
          examples: ['量子计算', '旅行', '数据可视化'],
        },
        scope: {
          type: 'string',
          enum: ['notes', 'gallery', 'anthology'],
          description: '限定搜索范围,不确定时不传',
        },
        limit: {
          type: 'number',
          description: '返回上限,默认 10',
        },
      },
      examples: [{ query: '量子计算' }, { query: '旅行', scope: 'gallery' }],
      required: ['query'],
    }),
    execute: async ({
      query,
      scope,
      limit = 10,
    }: {
      query: string;
      scope?: string;
      limit?: number;
    }) => {
      try {
        // 多取 1 条判断 hasMore,不静默丢。
        // visibility=all:搜最新已提交内容(含未发布)——发布只是对外状态,后台/Aurora 不受限。
        const raw = await contentService.searchWithScope({
          q: query,
          scope,
          pageSize: limit + 1,
          visibility: ContentVisibility.all,
        });
        const hasMore = raw.length > limit;
        const shown = raw.slice(0, limit);

        if (shown.length === 0) {
          return toolResult(`没找到匹配「${query}」的内容`, undefined, {
            status: 'not_found',
            total: 0,
          });
        }

        const detail = shown
          .map(
            (r) =>
              `[${r.scope}] ${r.title} (${r.updatedAt.slice(0, 10)})\n  ${r.contentItemId}\n  ${r.snippet}`,
          )
          .join('\n\n');

        // 行内 = 关键词 + 命中数(去掉多余的"搜",工具名 Search 已表意)。
        // ⎿ = 真实命中:标题 · 类型 — 命中摘要 —— search 的重点就是"命中了哪几篇、多相关"。
        const summary = `「${query}」· 命中 ${shown.length}${hasMore ? '+' : ''} 篇`;
        const list = shown.map((r) => {
          const label = SCOPE_LABEL[r.scope] ?? r.scope;
          const snip = (r.snippet ?? '').replace(/\s+/g, ' ').trim();
          const snipShort = snip.length > 36 ? `${snip.slice(0, 36)}…` : snip;
          return snipShort
            ? `${r.title} · ${label} — ${snipShort}`
            : `${r.title} · ${label}`;
        });
        return toolResult(summary, detail, {
          status: 'ok',
          shown: shown.length,
          hasMore,
          list,
        });
      } catch {
        return toolResult('搜索失败,请换关键词重试', undefined, {
          status: 'error',
        });
      }
    },
  });
}
