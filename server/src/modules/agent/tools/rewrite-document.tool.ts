import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';

/**
 * rewrite_document —— 整篇重写当前草稿(纯管道)。
 *
 * 适用:用户明确要求"整体改/重写整篇/全文调"。newMarkdown 是【完整】新版正文,
 * 前端做整篇 diff(applyAISuggestions over editor.children)产 suggestion 痕迹。
 * 上限 60k 字符——再大说明意图可能误读,先停下来澄清。
 */
const MAX = 60_000;

export function createRewriteDocumentTool() {
  return tool({
    description:
      '整篇重写当前草稿。仅在用户明确要求"整体改/重写整篇/全文调"时使用。newMarkdown 是【完整】新版正文(不要只给片段)。',
    inputSchema: jsonSchema<{ newMarkdown: string; reason: string }>({
      type: 'object',
      properties: {
        newMarkdown: { type: 'string', description: '完整新版正文(markdown)' },
        reason: { type: 'string', description: '为什么这样整体改' },
      },
      required: ['newMarkdown', 'reason'],
    }),
    execute: ({ newMarkdown, reason }: { newMarkdown: string; reason: string }) => {
      if (typeof newMarkdown !== 'string' || newMarkdown.length === 0 || newMarkdown.length > MAX) {
        return toolResult('未生成有效整篇改写', undefined, { status: 'invalid', reason: reason ?? '' });
      }
      return toolResult('已生成整篇改写,待用户在编辑器确认', undefined, {
        status: 'ok',
        reason: reason ?? '',
      });
    },
  });
}
