import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import { computeBodyHash } from './body-hash.utils';
import type { DocumentContext } from './get-current-document.tool';

/**
 * propose_document_rewrite —— v3 改稿单工具(纯管道 + bodyHash 强校验)。
 *
 * 用户明确要求修改正文时调用。**调用前必须先 get_current_draft 拿到 bodyHash**,
 * 作为参数传入。服务器对比当前文档 hash:
 *   - 匹配 → status:ok,前端做 smart LCS diff 算 hunks,红删/绿增 overlay 审批
 *   - 不匹配 → status:stale + currentMarkdown(detail),让模型 multi-step 基于最新版重生成
 *   - bodyHash 空/无文档 → status:invalid
 *
 * 工厂收 lazy getter(同 get_current_draft):与 get_current_draft 签名对齐;
 * 当前 entryContext 单请求内 immutable,getter 等价于 snapshot;形态为未来
 * chat 期间文档热更替留接口。
 */
export const MAX_NEW_MARKDOWN = 60_000;

export function createProposeDocumentRewriteTool(
  getDocument: () => DocumentContext | undefined,
) {
  return tool({
    description:
      '为当前草稿生成改稿提议。**调用前必须先 get_current_draft 拿到 bodyHash,然后作为同名参数传入**。服务器对比 bodyHash 与当前文档 hash,不符返回 stale + 最新正文,你需基于最新版重生成。给出 newMarkdown(完整新版**正文**,不要片段)+ reason(一句话整体意图)+ bodyHash。**newMarkdown 只含正文,不要包含文档标题行(如 `# 标题`)——标题是独立字段,正文不含它;若混入标题,前端 diff 会把标题误判成新增段落**。前端会基于完整新版做算法 diff,红删/绿增 overlay 形式展示,用户逐项 ✓/✗ 决定。引用块(`> 第 N 段:「…」`)只是用户特别想让你看的几段,不是必须改的范围——你自由决定改哪。',
    inputSchema: jsonSchema<{
      newMarkdown: string;
      reason: string;
      bodyHash: string;
    }>({
      type: 'object',
      properties: {
        newMarkdown: { type: 'string', description: '完整新版正文(markdown)' },
        reason: { type: 'string', description: '为什么这样改' },
        bodyHash: {
          type: 'string',
          description: '上次 get_current_draft 返回的 meta.bodyHash,必填',
        },
      },
      required: ['newMarkdown', 'reason', 'bodyHash'],
    }),
    execute: ({
      newMarkdown,
      reason,
      bodyHash,
    }: {
      newMarkdown: string;
      reason: string;
      bodyHash: string;
    }) => {
      if (
        typeof newMarkdown !== 'string' ||
        newMarkdown.length === 0 ||
        newMarkdown.length > MAX_NEW_MARKDOWN
      ) {
        return toolResult('未生成有效改稿', undefined, {
          status: 'invalid',
          reason: reason ?? '',
        });
      }

      if (typeof bodyHash !== 'string' || bodyHash.length === 0) {
        return toolResult('bodyHash 必填,请先调 get_current_draft', undefined, {
          status: 'invalid',
          reason: reason ?? '',
        });
      }

      const document = getDocument();
      if (!document) {
        return toolResult('当前没有打开的草稿,无法改稿', undefined, {
          status: 'invalid',
          reason: reason ?? '',
        });
      }

      const currentBodyHash = computeBodyHash(document.bodyMarkdown);
      if (bodyHash !== currentBodyHash) {
        return toolResult(
          '文档已变化,请基于最新版本重新生成',
          `文档已被修改,以下是当前最新正文(bodyHash: ${currentBodyHash}):\n\n${document.bodyMarkdown}`,
          {
            status: 'stale',
            currentBodyHash,
            receivedBodyHash: bodyHash,
            reason: reason ?? '',
          },
        );
      }

      return toolResult('已生成待审批改稿', undefined, {
        status: 'ok',
        reason: reason ?? '',
      });
    },
  });
}
