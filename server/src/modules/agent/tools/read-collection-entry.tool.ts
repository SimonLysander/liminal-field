import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import type { DocumentContext } from './get-current-document.tool';

/**
 * AnthologyEntryReader —— read_collection_entry 只需要的最小读取接口。
 * AnthologyViewService.getEntryDetail 结构上满足它(返回类型含 title/bodyMarkdown,多出的字段无害)。
 */
export interface AnthologyEntryReader {
  getEntryDetail(
    contentItemId: string,
    entryKey: string,
    usePublished?: boolean,
  ): Promise<{ title: string; bodyMarkdown: string }>;
}

/**
 * read_collection_entry —— 读当前文集里「另一篇条目」的当前内容。
 *
 * 仅文集条目场景挂载(当前文档 contentItemId 形如 `${anthologyId}:${entryKey}`)。
 * 读**最新已提交**内容(usePublished=false):发布只是对外状态,后台/Aurora 看最新已提交,
 * 与发不发布无关。当前正在编辑的这篇请用 get_current_draft(那是 live 草稿)。
 *
 * 范围克制:只读单一版本(最新已提交),不带 version 参数、不支持回溯历史版本——
 * 模型需要的是"兄弟篇现在说什么",版本回溯是人在版本时间线 UI 里干的事。
 */
export function createReadCollectionEntryTool(
  getDocument: () => DocumentContext | undefined,
  reader: AnthologyEntryReader,
) {
  return tool({
    description:
      '读取当前文集里另一篇条目的当前内容(最新已提交,不论是否发布)。编辑本条目时用它参考同集其它篇——做衔接、避免重复、保持风格一致。entryKey 取自 <collection> 列表。当前正在编辑的这篇用 get_current_draft,不要用本工具。',
    inputSchema: jsonSchema<{ entryKey: string }>({
      type: 'object',
      properties: {
        entryKey: {
          type: 'string',
          description:
            '要读的同集条目 key(见 system prompt 的 <collection> 列表)',
        },
      },
      required: ['entryKey'],
    }),
    execute: async ({ entryKey }: { entryKey: string }) => {
      const contentItemId = getDocument()?.contentItemId ?? '';
      const sep = contentItemId.indexOf(':');
      if (sep < 0) {
        return toolResult('当前不在文集条目场景,无法读集内条目', undefined, {
          status: 'invalid',
        });
      }
      const anthologyId = contentItemId.slice(0, sep);
      const currentEntryKey = contentItemId.slice(sep + 1);
      if (entryKey === currentEntryKey) {
        return toolResult(
          '这就是你正在编辑的当前条目,请改用 get_current_draft',
          undefined,
          { status: 'invalid' },
        );
      }
      try {
        const entry = await reader.getEntryDetail(anthologyId, entryKey, false);
        const total = entry.bodyMarkdown.length;
        return toolResult(
          `《${entry.title || '未命名条目'}》· ${total} 字`,
          entry.bodyMarkdown,
          { status: 'ok', entryKey, wordCount: total },
        );
      } catch {
        return toolResult(`找不到条目 ${entryKey}(key 错了或已删)`, undefined, {
          status: 'not_found',
        });
      }
    },
  });
}
