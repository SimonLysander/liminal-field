import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';

/**
 * rewrite_selection —— 改写用户在编辑器中【已选中】的段(纯管道工具)。
 *
 * 不碰正文:execute 只校验 newMarkdown,把 { newMarkdown, reason } 透传到前端
 * (经 message.parts 的 tool-rewrite_selection part)。前端读 part.input.newMarkdown,
 * 配合当前选区锚点调 applyAISuggestions 落成 suggestion 痕迹。
 *
 * 用前提:system prompt 的 <selection> 节告诉模型当前有选区;无选区时模型不该调用本工具
 * (应改用 rewrite_document 或先澄清)。前端路由时再次检查 anchor,无选区会报 no-anchor 兜底。
 */
const MAX = 60_000;

export function createRewriteSelectionTool() {
  return tool({
    description:
      '改写用户当前在编辑器中【已选中】的内容。仅当 <selection> 节有效时使用。给出 newMarkdown(改成的新文本)+ reason(为什么改,显示给用户)。改动会以 suggestion 痕迹出现,由用户接受/拒绝——你只负责生成新内容,定位由编辑器选区锚点提供。',
    inputSchema: jsonSchema<{ newMarkdown: string; reason: string }>({
      type: 'object',
      properties: {
        newMarkdown: { type: 'string', description: '改成的新文本(markdown)' },
        reason: { type: 'string', description: '这处为什么改' },
      },
      required: ['newMarkdown', 'reason'],
    }),
    execute: ({ newMarkdown, reason }: { newMarkdown: string; reason: string }) => {
      if (typeof newMarkdown !== 'string' || newMarkdown.length === 0 || newMarkdown.length > MAX) {
        return toolResult('未生成有效改动', undefined, { status: 'invalid', reason: reason ?? '' });
      }
      return toolResult('已生成改动,待用户在编辑器确认', undefined, {
        status: 'ok',
        reason: reason ?? '',
      });
    },
  });
}
