/**
 * write-draft.tool 单测。
 *
 * 覆盖：
 *   1. 正常写入 → status=ok，charCount 正确，saveAiDraft 携带正确参数
 *   2. saveAiDraft 抛出异常 → status=error，summary 含错误信息
 */

import {
  createWriteDraftTool,
  validateCitations,
  validateCitationAudit,
  composeAiDraftBody,
} from '../write-draft.tool';
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

  it('带 sources → 合成「来源」小节，引用标记转链接，sources 不落空', async () => {
    const repo = makeRepo();
    const t = createWriteDraftTool(repo as never, NOTE_ID);
    const md = '# 标题\n\nReact 16 于 2017 发布[@#CIT 1]。';
    const sources = [{ title: 'React 博客', url: 'https://r.dev/16' }];

    const result = parse(
      await run(t, {
        markdown: md,
        sources,
        citationAudit: {
          conceptsAndDefinitions: [
            { claim: 'React 16 发布年份', sourceIndexes: [1] },
          ],
        },
      }),
    );
    expect(result.meta.status).toBe('ok');

    const { bodyMarkdown } = (repo.saveAiDraft as jest.Mock).mock
      .calls[0][0] as { bodyMarkdown: string };
    expect(bodyMarkdown).toContain('[1](https://r.dev/16#cit-1 "React 博客")'); // 标记转为可识别 citation 链接
    expect(bodyMarkdown).toContain('## 来源'); // 篇末来源小节
    expect(bodyMarkdown).toContain('1. [React 博客](https://r.dev/16)');
  });

  it('悬空引用（标了 [@#CIT 2] 却只有 1 源）→ status=error，不落库', async () => {
    const repo = makeRepo();
    const t = createWriteDraftTool(repo as never, NOTE_ID);
    const md = '# 标题\n\n某断言[@#CIT 2]。';
    const sources = [{ title: 'A', url: 'https://a.dev' }];

    const result = parse(await run(t, { markdown: md, sources }));
    expect(result.meta.status).toBe('error');
    expect(repo.saveAiDraft).not.toHaveBeenCalled();
  });

  it('带 sources 但缺 citationAudit → status=error，不落库', async () => {
    const repo = makeRepo();
    const t = createWriteDraftTool(repo as never, NOTE_ID);
    const md = '# 标题\n\nf-number 是焦距与有效孔径直径之比[@#CIT 1]。';
    const sources = [{ title: 'Optics', url: 'https://example.dev/f-number' }];

    const result = parse(await run(t, { markdown: md, sources }));

    expect(result.meta.status).toBe('error');
    expect(result.summary).toContain('citationAudit');
    expect(repo.saveAiDraft).not.toHaveBeenCalled();
  });
});

describe('validateCitations', () => {
  const ok = [{ title: 'A', url: 'https://a' }];

  it('无标记无来源 → 通过', () => {
    expect(validateCitations('纯思辨，没有外部事实。', [])).toBeNull();
  });

  it('标记都在 sources 范围内 → 通过', () => {
    expect(validateCitations('见[@#CIT 1]。', ok)).toBeNull();
  });

  it('范围引用越界（[@#CIT 1-3] 但只有 2 源）→ 报错', () => {
    const err = validateCitations('见[@#CIT 1-3]。', [
      { title: 'A', url: 'https://a' },
      { title: 'B', url: 'https://b' },
    ]);
    expect(err).toContain('CIT 3');
  });

  it('多引越界（[@#CIT 1,4]）→ 报错', () => {
    const err = validateCitations('见[@#CIT 1,4]。', ok);
    expect(err).toContain('CIT 4');
  });

  it('来源缺 url → 报错', () => {
    const err = validateCitations('见[@#CIT 1]。', [{ title: 'A', url: '' }]);
    expect(err).toContain('缺 title 或 url');
  });
});

describe('validateCitationAudit', () => {
  const sources = [{ title: 'A', url: 'https://a' }];

  it('有 sources 时必须提交 citationAudit', () => {
    expect(validateCitationAudit(undefined, sources)).toContain(
      'citationAudit',
    );
  });

  it('audit 引用不存在的 source index → 报错', () => {
    const err = validateCitationAudit(
      {
        conceptsAndDefinitions: [
          { claim: 'f-number 定义', sourceIndexes: [2] },
        ],
      },
      sources,
    );
    expect(err).toContain('sourceIndexes');
  });

  it('audit 覆盖至少一类内容且索引有效 → 通过', () => {
    expect(
      validateCitationAudit(
        {
          conceptsAndDefinitions: [
            { claim: 'f-number 定义', sourceIndexes: [1] },
          ],
        },
        sources,
      ),
    ).toBeNull();
  });
});

describe('composeAiDraftBody', () => {
  it('无来源 → 原样返回（纯思辨篇保持干净）', () => {
    expect(composeAiDraftBody('讲道理的一段。', [])).toBe('讲道理的一段。');
  });

  it('范围/多引展开成各自可点链接', () => {
    const body = composeAiDraftBody('见[@#CIT 1-3]。', [
      { title: 'A', url: 'https://a' },
      { title: 'B', url: 'https://b' },
      { title: 'C', url: 'https://c' },
    ]);
    expect(body).toContain(
      '[1](https://a#cit-1 "A"),[2](https://b#cit-2 "B"),[3](https://c#cit-3 "C")',
    );
    expect(body).toContain('## 来源');
  });
});
