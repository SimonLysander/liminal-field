/**
 * read_content — 读取一个节点的内容三层（已提交正文 + 用户草稿 + AI 初稿）。
 *
 * 三段隔离语义：
 * - 【正文 · 最新已发布/已提交】：NoteViewService.getById(id, 'all') 读最新已提交版本，
 *   不论是否对外发布（visibility='all'）；节点尚无提交（快照不存在）时静默跳过，不报错。
 * - 【我的草稿 · 未提交】：draft:{id} 的 bodyMarkdown，用户工作中的未提交草稿。
 * - 【AI 初稿 · Aurora 研究稿 · 只读参照】：aidraft:{id}，learning-writer 写入；
 *   对用户只读，永不参与 commit/publish；普通节点缺失是正常态，静默跳过。
 *
 * 此工具只读不写；对没有 aidraft 的节点，只是少一段，其它行为不变。
 *
 * planner（reading + planning）和 writer（drafting）都可用此工具。
 */
import { tool, jsonSchema } from 'ai';
import type { NoteViewService } from '../../workspace/note-view.service';
import type { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { toolResult } from './tool-result';

/**
 * @param noteViewService   读最新已提交正文（visibility='all'）
 * @param editorDraftRepo   读用户草稿（draft:）和 AI 初稿（aidraft:）
 */
export function createReadContentTool(
  noteViewService: NoteViewService,
  editorDraftRepo: EditorDraftRepository,
) {
  return tool({
    description:
      '读取一个笔记节点的全部内容层：① 已发布/已提交的正文 ② 用户未提交草稿 ③ Aurora AI 初稿（只读参照）。三段各自独立，哪段有返哪段；都没有就返回"该节点暂无内容"。只读不写。planner 和 writer 均可调用。',
    inputSchema: jsonSchema<{ contentItemId: string }>({
      type: 'object',
      properties: {
        contentItemId: {
          type: 'string',
          description: '目标节点的 contentItemId',
        },
      },
      required: ['contentItemId'],
    }),
    execute: async ({ contentItemId }: { contentItemId: string }) => {
      const sections: string[] = [];

      // ── ① 已发布/已提交正文（visibility='all'）──────────────────────────────
      // 节点尚未提交（无快照）时 getById 抛异常，静默 catch 继续后续两段。
      try {
        const doc = await noteViewService.getById(contentItemId, 'all');
        if (doc.bodyMarkdown) {
          sections.push(`【正文 · 最新已发布/已提交】\n${doc.bodyMarkdown}`);
        }
      } catch {
        // 节点无快照或 id 无效 → 跳过，不影响草稿/aidraft 段
      }

      // ── ② 用户草稿（draft:{id}，用户未提交的在编版本）───────────────────────
      try {
        const draft = await editorDraftRepo.findByContentItemId(contentItemId);
        if (draft?.bodyMarkdown) {
          sections.push(`【我的草稿 · 未提交】\n${draft.bodyMarkdown}`);
        }
      } catch {
        // 查询失败时静默跳过，不让草稿缺失影响整体
      }

      // ── ③ AI 初稿（aidraft:{id}，Aurora 写入，对用户只读）──────────────────
      // 普通节点无 aidraft 是正常态，不报错。
      try {
        const aiDraft =
          await editorDraftRepo.findAiDraftByContentItemId(contentItemId);
        if (aiDraft?.bodyMarkdown) {
          sections.push(
            `【AI 初稿 · Aurora 研究稿 · 只读参照】\n${aiDraft.bodyMarkdown}`,
          );
        }
      } catch {
        // aidraft 缺失是正常状态，不报错
      }

      if (sections.length === 0) {
        return toolResult(`节点 ${contentItemId} 暂无内容`, '该节点暂无内容', {
          status: 'ok',
          sections: 0,
        });
      }

      const detail = sections.join('\n\n---\n\n');
      return toolResult(`读取完成（${sections.length} 段）`, detail, {
        status: 'ok',
        sections: sections.length,
      });
    },
  });
}
