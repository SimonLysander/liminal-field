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
 * 任意读操作失败时静默返回 null，不中断其余段的读取。
 * 三段各自独立：① 无快照 getById 抛异常是正常态；② 草稿/aidraft 缺失同理。
 */
async function safeFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

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
      '读取一个笔记节点的真实内容：① 已发布/已提交的正文 ② 用户未提交草稿。两段各自独立，哪段有返哪段；都没有就返回"该节点暂无内容"。不返回 Aurora 自己写的 AI 初稿（那是产出、不是源材料，读回给自己无意义）。只读不写。planner 和 writer 均可调用。',
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

      // ── ① 已发布/已提交正文（visibility='all'）
      const doc = await safeFetch(() =>
        noteViewService.getById(contentItemId, 'all'),
      );
      if (doc?.bodyMarkdown) {
        sections.push(`【正文 · 最新已发布/已提交】\n${doc.bodyMarkdown}`);
      }

      // ── ② 用户草稿（draft:{id}，用户未提交的在编版本）
      const draft = await safeFetch(() =>
        editorDraftRepo.findByContentItemId(contentItemId),
      );
      if (draft?.bodyMarkdown) {
        sections.push(`【我的草稿 · 未提交】\n${draft.bodyMarkdown}`);
      }

      // ③ Aurora 自己的 AI 初稿(aidraft)不返回——那是产出不是源材料,读回给自己无意义。

      // 工具卡行内显示「读的是哪一篇」——取任一层的标题,兜底 contentItemId
      const title = doc?.title || draft?.title || contentItemId;

      if (sections.length === 0) {
        return toolResult(`《${title}》暂无内容`, '该节点暂无内容', {
          status: 'ok',
          sections: 0,
        });
      }

      const detail = sections.join('\n\n---\n\n');
      return toolResult(`读取《${title}》· ${sections.length} 段`, detail, {
        status: 'ok',
        sections: sections.length,
      });
    },
  });
}
