/**
 * write-draft.tool 单测。
 *
 * 覆盖：
 *   1. 正常写入 → status=ok，charCount 正确，saveAiDraft 携带正确参数
 *   2. saveAiDraft 抛出异常 → status=error，summary 含错误信息
 */

import { createWriteDraftTool } from '../write-draft.tool';
import type { EditorDraftRepository } from '../../../workspace/editor-draft.repository';

/** 调用工具 execute 的统一入口（与 write-learn-plan.tool.spec.ts 写法对齐） */
const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

const parse = (raw: string) => JSON.parse(raw);

function makeRepo(
  saveReturn: unknown = { _id: 'aidraft:note_001' },
): jest.Mocked<Pick<EditorDraftRepository, 'saveAiDraft'>> {
  return {
    saveAiDraft: jest.fn().mockResolvedValue(saveReturn),
  };
}

const NOTE_ID = 'ci_note_photography_light';

const MARKDOWN = `# 光从哪里来

摄影的本质是捕捉光。光从光源出发，经过反射、折射，最终抵达传感器。

## 自然光

太阳是最主要的自然光源，其方向和色温随时间变化。

## 人工光

灯具提供可控的稳定光源，配合反射伞和柔光箱塑形。
`;

describe('write-draft.tool', () => {
  it('正常写入 → status=ok，charCount 正确，saveAiDraft 携带正确参数', async () => {
    const repo = makeRepo();
    const t = createWriteDraftTool(repo as never, NOTE_ID);

    const result = parse(await run(t, { markdown: MARKDOWN }));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.charCount).toBe(MARKDOWN.length);

    // saveAiDraft 必须被调用，contentItemId 为绑定的 noteId，changeNote 为 'learn-draft'
    expect(repo.saveAiDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        contentItemId: NOTE_ID,
        changeNote: 'learn-draft',
        bodyMarkdown: MARKDOWN,
      }),
    );

    // title 应从第一个 # 标题提取
    const { title } = (repo.saveAiDraft as jest.Mock).mock.calls[0][0] as {
      title: string;
    };
    expect(title).toBe('光从哪里来');
  });

  it('saveAiDraft 抛出异常 → status=error，summary 含错误信息', async () => {
    const repo = {
      saveAiDraft: jest.fn().mockRejectedValue(new Error('MongoDB timeout')),
    };
    const t = createWriteDraftTool(repo as never, NOTE_ID);

    const result = parse(await run(t, { markdown: MARKDOWN }));

    expect(result.meta.status).toBe('error');
    expect(result.summary).toContain('MongoDB timeout');
  });
});
