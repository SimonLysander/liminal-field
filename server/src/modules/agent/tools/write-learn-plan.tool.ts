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
 *   goal           — 本次学习的核心目标（一句话，前端展示为规划标题）
 *   understanding  — 对主题的理解，自然段叙述（立锚 + 因果拓扑）
 *   items[]        — 篇目提案列表（有序）
 *     .title       — 篇名
 *     .thread      — 脉络词（关键概念/因果线索）
 *     .why         — 为何写这一章（学习意图）
 *
 * BodyMarkdown 契约格式（前端按此解析，务必稳定）：
 *
 * ---
 * goal: <goal>
 * items:
 *   - title: <title>
 *     thread: <thread>
 *     why: <why>
 *   - ...
 * ---
 * <understanding 散文 markdown>
 */
import { tool, jsonSchema } from 'ai';
import { dump } from 'js-yaml';
import type { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { toolResult } from './tool-result';

export interface PlanItem {
  title: string;
  thread: string;
  why: string;
}

/**
 * 将 goal + items + understanding 序列化为 YAML frontmatter + 散文正文。
 *
 * 契约格式（前端解析此格式，切勿改动结构）：
 *   ---
 *   goal: <goal>
 *   items:
 *     - title: <title>
 *       thread: <thread>
 *       why: <why>
 *   ---
 *   <understanding 散文>
 *
 * 用 js-yaml dump 序列化，避免手拼 YAML 的转义风险。
 */
export function serializeToDraftMarkdown(
  goal: string,
  understanding: string,
  items: PlanItem[],
): string {
  const frontmatterData = {
    goal,
    items: items.map(({ title, thread, why }) => ({ title, thread, why })),
  };
  // lineWidth: -1 禁止自动折行，保持字符串完整（防止长标题/长 why 被截断）
  const yaml = dump(frontmatterData, { lineWidth: -1 }).trimEnd();
  return `---\n${yaml}\n---\n\n${understanding}`;
}

export function createWriteLearnPlanTool(
  editorDraftRepo: EditorDraftRepository,
  topicContentItemId: string,
) {
  return tool({
    description:
      '把学习规划的「目标 + 理解 + 篇目脉络」写入当前主题的 AI 草稿区，供所有者在左栏只读查看。调用前：目标明确、理解段已成文（立锚 + 因果拓扑），脉络提案已有序排好。工具只落库，不建任何节点——建篇是所有者的事。',
    inputSchema: jsonSchema<{
      goal: string;
      understanding: string;
      items: PlanItem[];
      changeSummary?: string;
    }>({
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description:
            '本次学习的核心目标（一句话，前端展示为规划标题，如「理解 React 渲染机制，能独立排查性能问题」）',
        },
        understanding: {
          type: 'string',
          description:
            '对主题的理解：自然成段叙述，先立底层原理/第一性概念为锚，再顺因果推出整条认知脉络；末句自然引出篇目结构。',
        },
        items: {
          type: 'array',
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
                  '为何写这一章：一句话讲清这篇在整条因果链中的学习意图',
              },
            },
            required: ['title', 'thread', 'why'],
          },
        },
        changeSummary: {
          type: 'string',
          description:
            '一句话说明这次规划相比现有改了什么（重排/增删/调整哪几篇等，供用户审批时一眼看懂）。直接陈述,不加「本次/说明」之类前缀。',
        },
      },
      required: ['goal', 'understanding', 'items'],
    }),
    // changeSummary 是审批用元信息,不参与落库(gate 暂存进 preview),execute 只用 goal/understanding/items。
    execute: async ({
      goal,
      understanding,
      items,
    }: {
      goal: string;
      understanding: string;
      items: PlanItem[];
      changeSummary?: string;
    }) => {
      try {
        const bodyMarkdown = serializeToDraftMarkdown(
          goal,
          understanding,
          items,
        );

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
