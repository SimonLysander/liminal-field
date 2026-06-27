/**
 * write-learn-plan.tool 单测。
 *
 * 覆盖：
 *   1. 正常写入 → status=ok，itemsCount 正确，saveAiDraft 携带正确参数
 *   2. saveAiDraft 抛出异常 → status=error，summary 含错误信息
 */

import { createWriteLearnPlanTool } from '../write-learn-plan.tool';
import type { EditorDraftRepository } from '../../../workspace/editor-draft.repository';

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

const UNDERSTANDING =
  '摄影的底层原理是光的控制。所有的曝光讲究、构图法则、后期处理，追到底都在回答同一个问题：如何把光塑造成你想要的样子。顺着这条线，落成下面这几篇：';

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
  it('正常写入 → status=ok，itemsCount 正确，saveAiDraft 携带正确参数', async () => {
    const repo = makeRepo();
    const tool = createWriteLearnPlanTool(repo as never, TOPIC_ID);

    const result = parse(
      await run(tool, { understanding: UNDERSTANDING, items: ITEMS }),
    );

    expect(result.meta.status).toBe('ok');
    expect(result.meta.itemsCount).toBe(ITEMS.length);

    // saveAiDraft 必须被调用，contentItemId 为主题 id，changeNote 为 'learn-plan'
    expect(repo.saveAiDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: TOPIC_ID,
        title: '学习规划',
        changeNote: 'learn-plan',
      }),
    );

    // bodyMarkdown 应包含 understanding 段和各篇 title
    const { bodyMarkdown } = (repo.saveAiDraft as jest.Mock).mock
      .calls[0][0] as { bodyMarkdown: string };
    expect(bodyMarkdown).toContain(UNDERSTANDING);
    expect(bodyMarkdown).toContain('光从哪里来');
    expect(bodyMarkdown).toContain('曝光三要素');
    expect(bodyMarkdown).toContain('目的');
  });

  it('saveAiDraft 抛出异常 → status=error，summary 含错误信息', async () => {
    const repo = {
      saveAiDraft: jest.fn().mockRejectedValue(new Error('MongoDB timeout')),
    };
    const tool = createWriteLearnPlanTool(repo as never, TOPIC_ID);

    const result = parse(
      await run(tool, { understanding: UNDERSTANDING, items: ITEMS }),
    );

    expect(result.meta.status).toBe('error');
    expect(result.summary).toContain('MongoDB timeout');
  });
});
