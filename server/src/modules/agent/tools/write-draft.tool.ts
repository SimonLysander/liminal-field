/**
 * write_draft — 学习场景 AI 初稿写入工具（learning-writer agent 专用）。
 *
 * 设计要点：
 * 1. 目标节点从上下文绑定（noteContentItemId 工厂入参），不由模型传 ——
 *    防止 learning-writer 越权往任意节点写（模型只能写它自己正在操作的那一篇）。
 * 2. 只写 aidraft:{noteId}，绝不碰 draft:（用户草稿）、绝不建节点。
 *    aidraft 对用户只读，永不参与 commit/publish 流水线。
 * 3. title 从 markdown 第一个 # 标题提取；summary 取首个非标题段截断。
 *
 * 入参 schema：
 *   markdown — 完整 AI 初稿正文（含标题和所有章节）
 */
import { tool, jsonSchema } from 'ai';
import type { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { toolResult } from './tool-result';

/** 从 markdown 提取标题：优先取第一个 # 标题，退而取首行（去除空白），截断至 80 字。 */
export function extractTitle(markdown: string): string {
  const headingMatch = markdown.match(/^#{1,6}\s+(.+)/m);
  if (headingMatch) return headingMatch[1].trim().slice(0, 80);
  return markdown.split('\n')[0]?.trim().slice(0, 80) ?? '（无标题）';
}

/** 从 markdown 提取摘要：跳过标题行，取第一个非空非标题段，截断至 150 字。 */
export function extractSummary(markdown: string): string {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) return trimmed.slice(0, 150);
  }
  return '';
}

/**
 * @param editorDraftRepo  草稿仓库（aidraft 写入口）
 * @param noteContentItemId  当前学习节点的 contentItemId（上下文绑定，模型不传）
 */
export function createWriteDraftTool(
  editorDraftRepo: EditorDraftRepository,
  noteContentItemId: string,
) {
  return tool({
    description:
      '把研究成果写成当前笔记节点的 AI 初稿（aidraft），供用户只读参考。调用前：全文已成稿，能独立成篇（有标题、有正文）。每次调用整体覆盖，保持最新一份。只写当前这一篇，目标节点已由系统固定，无法改变。',
    inputSchema: jsonSchema<{ markdown: string }>({
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            '完整 markdown 正文（# 标题开头，包含所有章节内容，不要截断）',
        },
      },
      required: ['markdown'],
    }),
    execute: async ({ markdown }: { markdown: string }) => {
      try {
        const title = extractTitle(markdown);
        const summary = extractSummary(markdown);

        // aidraft 前缀保证 commit/publish 路径天然看不见此草稿；对用户只读。
        await editorDraftRepo.saveAiDraft({
          contentItemId: noteContentItemId,
          bodyMarkdown: markdown,
          title,
          summary,
          changeNote: 'learn-draft',
          savedAt: new Date(),
        });

        return toolResult(`AI 初稿已写入（${markdown.length} 字）`, undefined, {
          status: 'ok',
          charCount: markdown.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`write_draft 写入失败：${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
