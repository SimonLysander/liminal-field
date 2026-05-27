import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';

/**
 * propose_document_rewrite —— v3 改稿单工具(纯管道)。
 *
 * 用户明确要求修改正文时(改紧凑/重写/调整结构等)调用。模型给出
 * 完整新版正文(newMarkdown),前端做 smart LCS diff 计算 hunks,
 * 以红删/绿增 overlay 在原位置就地展示,用户逐项 ✓/✗ 决定。
 *
 * 工具本身不碰正文,不算 diff,不验证 newMarkdown 是否真有变化——
 * 那是前端 compute-doc-diff 的责任(无变化时给"未生成实际改动"提示)。
 *
 * 引用块(`> 第 N 段:「…」`)是用户特别想让模型看的几段,不是必须改
 * 的范围——模型自由决定改哪。
 */
export const MAX_NEW_MARKDOWN = 60_000;

export function createProposeDocumentRewriteTool() {
  return tool({
    description:
      '为当前草稿生成改稿提议。用户明确要求修改正文时(改紧凑/重写/调整结构等)使用,给出 newMarkdown(完整新版正文,不要片段)+ reason(一句话整体意图)。前端会基于完整新版做算法 diff,以红删/绿增 overlay 形式在原位置展示,用户逐项 ✓/✗ 决定。引用块(`> 第 N 段:「…」`)只是用户特别想让你看的几段,不是必须改的范围——你自由决定改哪。',
    inputSchema: jsonSchema<{ newMarkdown: string; reason: string }>({
      type: 'object',
      properties: {
        newMarkdown: { type: 'string', description: '完整新版正文(markdown)' },
        reason: { type: 'string', description: '为什么这样改' },
      },
      required: ['newMarkdown', 'reason'],
    }),
    execute: ({ newMarkdown, reason }: { newMarkdown: string; reason: string }) => {
      if (typeof newMarkdown !== 'string' || newMarkdown.length === 0 || newMarkdown.length > MAX_NEW_MARKDOWN) {
        return toolResult('未生成有效改稿', undefined, {
          status: 'invalid',
          reason: reason ?? '',
        });
      }
      return toolResult('已生成待审批改稿', undefined, {
        status: 'ok',
        reason: reason ?? '',
      });
    },
  });
}
