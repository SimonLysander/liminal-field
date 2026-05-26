import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';

/**
 * insert_at_cursor —— 在用户光标所在块【之后】插入新内容(纯管道)。
 *
 * 适用:<cursor> 节告诉模型光标位置时,典型场景"在这里加一段例子"。
 * 前端读 part.input.newMarkdown 后,在 cursor 所在 path 之后 insertAINodes。
 */
const MAX = 60_000;

export function createInsertAtCursorTool() {
  return tool({
    description:
      '在用户光标当前所在块【之后】插入新内容。仅当 <cursor> 节有效且用户意图明显是"在这里加"时使用。给出 newMarkdown + reason。',
    inputSchema: jsonSchema<{ newMarkdown: string; reason: string }>({
      type: 'object',
      properties: {
        newMarkdown: { type: 'string', description: '插入的新文本(markdown)' },
        reason: { type: 'string', description: '为什么在这里加这段' },
      },
      required: ['newMarkdown', 'reason'],
    }),
    execute: ({ newMarkdown, reason }: { newMarkdown: string; reason: string }) => {
      if (typeof newMarkdown !== 'string' || newMarkdown.length === 0 || newMarkdown.length > MAX) {
        return toolResult('未生成有效插入', undefined, { status: 'invalid', reason: reason ?? '' });
      }
      return toolResult('已生成插入内容,待用户在编辑器确认', undefined, {
        status: 'ok',
        reason: reason ?? '',
      });
    },
  });
}
