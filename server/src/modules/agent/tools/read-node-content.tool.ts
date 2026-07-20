/**
 * read_content — 读取节点当前有效正文。
 *
 * 草稿优先：用户正在编辑的 draft:{id} 是唯一应交给智能体的版本；仅在草稿记录不存在时，
 * 才回退到最新已提交快照。空草稿同样是有效状态，不能泄漏已被用户清空的旧正文。
 * 版本对比属于版本管理，不由本工具承担，
 * 以免模型混用两个版本的句子。Aurora AI 初稿(aidraft:{id})始终不返回。
 */
import { tool, jsonSchema } from 'ai';
import type { NoteViewService } from '../../workspace/note-view.service';
import type { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { toolResult } from './tool-result';

/**
 * 任意读操作失败时返回 null。无快照或无草稿是正常态，不应中断调用。
 */
async function safeFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * @param noteViewService   草稿不存在时读最新已提交正文（visibility='all'）
 * @param editorDraftRepo   优先读用户草稿（draft:）
 */
export function createReadContentTool(
  noteViewService: NoteViewService,
  editorDraftRepo: EditorDraftRepository,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
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
      // 用户在编辑中的草稿是唯一有效版本；命中后不再读取快照，避免两版混入上下文。
      const draft = await safeFetch(() =>
        editorDraftRepo.findByContentItemId(contentItemId),
      );
      if (draft) {
        const title = draft.title || contentItemId;
        return toolResult(
          `读取《${title}》· 当前编辑草稿`,
          `【当前编辑草稿】\n${draft.bodyMarkdown}`,
          { status: 'ok', source: 'draft' },
        );
      }

      // 无草稿才回退最新已提交正文；visibility='all' 意味着它无需已对外发布。
      const doc = await safeFetch(() =>
        noteViewService.getById(contentItemId, 'all'),
      );
      const title = doc?.title || contentItemId;
      if (!doc?.bodyMarkdown) {
        return toolResult(`《${title}》暂无内容`, '该节点暂无内容', {
          status: 'ok',
          source: 'none',
        });
      }

      return toolResult(
        `读取《${title}》· 已提交正文`,
        `【已提交正文】\n${doc.bodyMarkdown}`,
        {
          status: 'ok',
          source: 'committed',
        },
      );
    },
  });
}
