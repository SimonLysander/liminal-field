import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import type { DocumentContext } from './get-current-document.tool';

/**
 * AnthologyEntryReader —— read_collection_entry 只需要的最小读取接口。
 * AnthologyViewService.getEntryDetail 结构上满足它(返回类型含 title/bodyMarkdown,多出的字段无害)。
 * 第二个参数 nodeId 与 Phase 1 后端统一节点模型对齐(原 entryKey)。
 */
export interface AnthologyEntryReader {
  getEntryDetail(
    contentItemId: string,
    nodeId: string,
    usePublished?: boolean,
  ): Promise<{ title: string; bodyMarkdown: string }>;
}

/**
 * read_collection_entry —— 读当前文集里「另一个子节点」的当前内容。
 *
 * 仅文集子节点场景挂载(当前文档 contentItemId 形如 `${anthologyId}:${nodeId}`)。
 * 读**最新已提交**内容(usePublished=false):发布只是对外状态,后台/Aurora 看最新已提交,
 * 与发不发布无关。当前正在编辑的这篇请用 get_current_draft(那是 live 草稿)。
 *
 * 范围克制:只读单一版本(最新已提交),不带 version 参数、不支持回溯历史版本——
 * 模型需要的是"兄弟节点现在说什么",版本回溯是人在版本时间线 UI 里干的事。
 */
export function createReadCollectionEntryTool(
  getDocument: () => DocumentContext | undefined,
  reader: AnthologyEntryReader,
) {
  return tool({
    description:
      '读取当前文集里另一个子节点的当前内容(最新已提交,不论是否发布)。编辑本节点时用它参考同集其它节点——做衔接、避免重复、保持风格一致。节点 id 取自 <collection> 列表。当前正在编辑的这篇用 get_current_draft,不要用本工具。',
    inputSchema: jsonSchema<{ nodeId: string }>({
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description:
            '要读的同集子节点 id(见 system prompt 的 <collection> 列表)',
        },
      },
      required: ['nodeId'],
    }),
    execute: async ({ nodeId }: { nodeId: string }) => {
      const contentItemId = getDocument()?.contentItemId ?? '';
      const sep = contentItemId.indexOf(':');
      if (sep < 0) {
        return toolResult('当前不在文集子节点场景,无法读集内节点', undefined, {
          status: 'invalid',
        });
      }
      const anthologyId = contentItemId.slice(0, sep);
      const currentNodeId = contentItemId.slice(sep + 1);
      if (nodeId === currentNodeId) {
        return toolResult(
          '这就是你正在编辑的当前节点,请改用 get_current_draft',
          undefined,
          { status: 'invalid' },
        );
      }
      try {
        const entry = await reader.getEntryDetail(anthologyId, nodeId, false);
        const total = entry.bodyMarkdown.length;
        return toolResult(
          `《${entry.title || '未命名节点'}》· ${total} 字`,
          entry.bodyMarkdown,
          { status: 'ok', nodeId, wordCount: total },
        );
      } catch {
        return toolResult(`找不到节点 ${nodeId}(id 错了或已删)`, undefined, {
          status: 'not_found',
        });
      }
    },
  });
}
