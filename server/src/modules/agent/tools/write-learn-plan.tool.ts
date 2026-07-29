/**
 * write_learn_plan — 学习规划工具（替代旧版 write_plan）。
 *
 * 设计要点：
 *
 * 1. 为何不要 LearningProject 数据模型：
 *    产品收敛后，篇目 = 真 NavigationNode 树，系统不代替用户建节点。
 *    规划本质是「对主题的 AI 提案」，不需要独立实体存储状态机。
 *
 * 2. 规划提案为何落 aidraft:{topicId}：
 *    规划是"对主题的 AI 提案"，不是某篇笔记的正文；
 *    用主题 contentItemId 作 key，前端用 aidraft:prefixed id 读取同一套草稿机制。
 *
 * 3. write_learn_plan 绝不建节点：
 *    用户自建节点是产品设计核心，AI 只提供参考。
 *    模型调此工具后只落库，由用户决定是否采纳脉络、手动建篇。
 *
 * 入参 schema：
 *   goal           — 本次学习的概要（前端展示为规划摘要）
 *   understanding  — 可供作者对照重写的 AI 总篇三段开篇
 *   items[]        — 篇目提案列表（有序）
 *     .title       — 篇名
 *     .thread      — 脉络词（关键概念/因果线索）
 *     .why         — 为何写这一章（学习意图）
 *   conclusion     — 节点线后的收束段，不复述篇目
 *
 * BodyMarkdown 契约格式（仅作为服务端持久化协议）：
 *
 * ---
 * goal: <goal>
 * items:
 *   - title: <title>
 *     thread: <thread>
 *     why: <why>
 *   - ...
 * conclusion: <conclusion markdown>
 * ---
 * <understanding 散文 markdown>
 */
import { tool, jsonSchema } from 'ai';
import type { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import {
  serializeLearnPlanDocument,
  type LearnPlanItem,
} from '../../workspace/learn-plan-document';
import { toolResult } from './tool-result';

export type PlanItem = LearnPlanItem;

interface WriteLearnPlanInput extends Record<string, unknown> {
  goal: string;
  understanding: string;
  items: PlanItem[];
  conclusion: string;
}

/**
 * write_learn_plan 的运行时契约校验。
 * 部分模型供应商会忽略 JSON Schema 的 required，因此直写与审批门禁必须共用这层校验。
 */
export function validateLearnPlanInput(
  input: unknown,
  options: { allowMissingConclusion?: boolean } = {},
): string | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return 'write_learn_plan 参数必须是对象。';
  }
  const args = input as Record<string, unknown>;
  const goal = typeof args['goal'] === 'string' ? args['goal'].trim() : '';
  if (!goal) return 'goal 不能为空，请提供学习规划的概要。';

  const understanding =
    typeof args['understanding'] === 'string'
      ? args['understanding'].trim()
      : '';
  if (!understanding) return 'understanding 不能为空，请提供规划开篇。';

  if (!Array.isArray(args['items'])) {
    return 'items 必须是有序篇目数组。';
  }
  if (args['items'].length === 0) {
    return 'items 不能为空，请至少提供一个篇目。';
  }
  for (const [index, item] of args['items'].entries()) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      return `items[${index}] 必须是篇目对象。`;
    }
    const record = item as Record<string, unknown>;
    for (const field of ['title', 'thread', 'why'] as const) {
      if (typeof record[field] !== 'string' || !record[field].trim()) {
        return `items[${index}].${field} 不能为空。`;
      }
    }
  }

  const conclusion =
    typeof args['conclusion'] === 'string' ? args['conclusion'].trim() : '';
  if (!conclusion && !options.allowMissingConclusion) {
    return 'conclusion 不能为空，请提供节点线后的自然收束。';
  }

  return null;
}

export function createWriteLearnPlanTool(
  editorDraftRepo: EditorDraftRepository,
  topicContentItemId: string,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<WriteLearnPlanInput>({
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description:
            '顶部概要：简明概括学习主题与最终要建立的理解或能力，不罗列篇目',
        },
        understanding: {
          type: 'string',
          description:
            'AI 总篇开篇，恰好三个自然段，不加标题或列表：第一段界定主题及范围；第二段说明它与作者目标的关系；第三段说明希望建立的理解或能力，并自然引出组织下方篇目的主线。不逐项复述篇目。',
        },
        items: {
          type: 'array',
          minItems: 1,
          description: '有序篇目提案列表（顺序即学习顺序）',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: '篇名（简洁，概括这一篇的核心议题）',
              },
              thread: {
                type: 'string',
                description:
                  '脉络词——这一篇在整条因果链上的节点标识（如「目的」「构造」「机制」「应用」）',
              },
              why: {
                type: 'string',
                description:
                  '说明这一篇在整条学习主线中的作用、与前后篇目的依赖，以及作者将在此建立的理解',
              },
            },
            required: ['title', 'thread', 'why'],
          },
        },
        conclusion: {
          type: 'string',
          description:
            '节点线后的总篇收束：综合整条学习路径并回扣作者的学习目的。写成自然文章结尾，不逐项复述篇目或再次列出标题。',
        },
      },
      required: ['goal', 'understanding', 'items', 'conclusion'],
    }),
    execute: async (input: WriteLearnPlanInput) => {
      const validationError = validateLearnPlanInput(input);
      if (validationError) {
        return toolResult(validationError, undefined, { status: 'invalid' });
      }
      const { goal, understanding, items, conclusion } = input;
      try {
        const bodyMarkdown = serializeLearnPlanDocument({
          goal,
          understanding,
          items,
          conclusion,
        });

        // understanding 首句作为草稿摘要（截断到 100 字）
        const summary =
          understanding.split(/[。！？\n]/)[0]?.slice(0, 100) ?? '';

        // 规划草稿落 aidraft:{topicId}，前端通过 EditorDraftRepository.buildAiDraftId 取回
        await editorDraftRepo.saveAiDraft({
          contentItemId: topicContentItemId,
          bodyMarkdown,
          title: goal,
          summary,
          changeNote: 'learn-plan',
          savedAt: new Date(),
        });

        return toolResult(`规划已写入：${items.length} 篇提案`, undefined, {
          status: 'ok',
          itemsCount: items.length,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`write_learn_plan 写入失败：${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
