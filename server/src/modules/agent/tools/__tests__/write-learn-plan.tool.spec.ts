/**
 * write-learn-plan.tool 单测。
 *
 * 覆盖：
 *   1. 正常写入 → status=ok，itemsCount 正确，saveAiDraft 携带正确参数
 *   2. 规划结构不完整 → status=invalid，不落库
 *   3. bodyMarkdown 格式：YAML frontmatter（含 goal + items + conclusion）+ understanding 散文正文
 *   4. saveAiDraft 抛出异常 → status=error，summary 含错误信息
 */

import { createWriteLearnPlanTool } from '../write-learn-plan.tool';
import type { EditorDraftRepository } from '../../../workspace/editor-draft.repository';
import { parseLearnPlanDocument } from '../../../workspace/learn-plan-document';

/** 调用工具 execute 的统一入口（与 pick.tool.spec.ts 写法对齐） */
const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

const parse = (raw: string) => JSON.parse(raw);

function makeRepo(
  saveReturn: unknown = { _id: 'aidraft:topic_001' },
): jest.Mocked<Pick<EditorDraftRepository, 'saveAiDraft'>> {
  return {
    saveAiDraft: jest.fn().mockResolvedValue(saveReturn),
  };
}

const TOPIC_ID = 'ci_topic_photography';

const GOAL = '理解摄影的光控逻辑，能独立分析构图与曝光的底层原因';

const UNDERSTANDING =
  '摄影首先是记录光的过程，相机只是把有限时间内抵达传感器的光转成画面。\n\n学习它，是为了把偶然拍到变成主动选择，能够判断光线与参数如何共同改变结果。\n\n这份笔记将沿成像、曝光与表达逐步展开，建立从物理过程走向画面判断的主线。';

const CONCLUSION =
  '由成像走向表达，这条路径最终要建立的不是参数记忆，而是面对真实光线时主动判断的能力。\n\n愿每一次按下快门，都有清楚的选择。';

const ITEMS = [
  {
    title: '光从哪里来',
    thread: '目的',
    why: '先立「光」这个锚，理解它是一切的来源。',
  },
  {
    title: '曝光三要素',
    thread: '构造',
    why: '光进入相机的三条控制杠杆，互相咬合。',
  },
  {
    title: '构图的逻辑',
    thread: '应用',
    why: '从光的视角看"什么是好构图"，而非记法则。',
  },
];

describe('write-learn-plan.tool', () => {
  it.each([
    {
      label: '开篇不是三个自然段',
      input: {
        goal: GOAL,
        understanding: '第一段。\n\n第二段。',
        items: ITEMS,
        conclusion: CONCLUSION,
        changeSummary: '按知识依赖组织规划。',
      },
    },
    {
      label: '缺少收束',
      input: {
        goal: GOAL,
        understanding: UNDERSTANDING,
        items: ITEMS,
        changeSummary: '按知识依赖组织规划。',
      },
    },
    {
      label: '没有篇目脉络',
      input: {
        goal: GOAL,
        understanding: UNDERSTANDING,
        items: [],
        conclusion: CONCLUSION,
        changeSummary: '按知识依赖组织规划。',
      },
    },
    {
      label: '缺少审批摘要',
      input: {
        goal: GOAL,
        understanding: UNDERSTANDING,
        items: ITEMS,
        conclusion: CONCLUSION,
      },
    },
  ])('$label → status=invalid，且不落库', async ({ input }) => {
    const repo = makeRepo();
    const tool = createWriteLearnPlanTool(repo as never, TOPIC_ID);

    const result = parse(await run(tool, input));

    expect(result.meta.status).toBe('invalid');
    expect(repo.saveAiDraft).not.toHaveBeenCalled();
  });

  it('正常写入 → status=ok，itemsCount 正确，saveAiDraft 携带正确参数', async () => {
    const repo = makeRepo();
    const tool = createWriteLearnPlanTool(repo as never, TOPIC_ID);

    const result = parse(
      await run(tool, {
        goal: GOAL,
        understanding: UNDERSTANDING,
        items: ITEMS,
        conclusion: CONCLUSION,
        changeSummary: '按知识依赖组织规划。',
      }),
    );

    expect(result.meta.status).toBe('ok');
    expect(result.meta.itemsCount).toBe(ITEMS.length);

    // saveAiDraft 必须被调用：contentItemId 为主题 id，title 为 goal，changeNote 为 'learn-plan'
    expect(repo.saveAiDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: TOPIC_ID,
        title: GOAL,
        changeNote: 'learn-plan',
      }),
    );

    // bodyMarkdown 必须是 YAML frontmatter + understanding 散文的契约格式
    const { bodyMarkdown } = (repo.saveAiDraft as jest.Mock).mock
      .calls[0][0] as { bodyMarkdown: string };

    // 1. 以 "---\n" 开头（frontmatter 存在）
    expect(bodyMarkdown).toMatch(/^---\n/);

    // 2. frontmatter 含 goal 字段
    expect(bodyMarkdown).toContain(`goal: ${GOAL}`);

    // 3. frontmatter 含 items（title / thread 在 YAML 中出现）
    expect(bodyMarkdown).toContain('光从哪里来');
    expect(bodyMarkdown).toContain('曝光三要素');
    expect(bodyMarkdown).toContain('目的');

    // 4. frontmatter 闭合后正文包含 understanding 散文
    const afterFrontmatter = bodyMarkdown.split(/^---$/m).slice(2).join('---');
    expect(afterFrontmatter).toContain(UNDERSTANDING);

    // 5. 收束段属于结构化规划元数据，复杂 Markdown 和换行必须完整保留
    expect(parseLearnPlanDocument(bodyMarkdown).conclusion).toBe(CONCLUSION);
  });

  it('saveAiDraft 抛出异常 → status=error，summary 含错误信息', async () => {
    const repo = {
      saveAiDraft: jest.fn().mockRejectedValue(new Error('MongoDB timeout')),
    };
    const tool = createWriteLearnPlanTool(repo as never, TOPIC_ID);

    const result = parse(
      await run(tool, {
        goal: GOAL,
        understanding: UNDERSTANDING,
        items: ITEMS,
        conclusion: CONCLUSION,
        changeSummary: '按知识依赖组织规划。',
      }),
    );

    expect(result.meta.status).toBe('error');
    expect(result.summary).toContain('MongoDB timeout');
  });
});
