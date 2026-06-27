/**
 * read-node-content.tool（read_content）单测。
 *
 * 覆盖：
 *   1. 三段都有 → status=ok，sections=3，detail 包含三段标签
 *   2. 三段都无 → status=ok，sections=0，summary 含"暂无内容"
 */

import { createReadContentTool } from '../read-node-content.tool';
import type { NoteViewService } from '../../../workspace/note-view.service';
import type { EditorDraftRepository } from '../../../workspace/editor-draft.repository';

/** 调用工具 execute 的统一入口 */
const run = (t: unknown, input: unknown): Promise<string> =>
  (t as { execute: (i: unknown, o: unknown) => Promise<string> }).execute(
    input,
    {},
  );

const parse = (raw: string) => JSON.parse(raw);

const CONTENT_ID = 'ci_note_001';
const PUBLISHED_BODY = '已发布的正文内容';
const DRAFT_BODY = '用户草稿内容';
const AI_DRAFT_BODY = 'Aurora AI 初稿内容';

describe('read-node-content.tool', () => {
  it('三段都有 → status=ok，sections=3，detail 包含三段标签', async () => {
    const noteViewService = {
      getById: jest.fn().mockResolvedValue({ bodyMarkdown: PUBLISHED_BODY }),
    } as unknown as jest.Mocked<Pick<NoteViewService, 'getById'>>;

    const editorDraftRepo = {
      findByContentItemId: jest
        .fn()
        .mockResolvedValue({ bodyMarkdown: DRAFT_BODY }),
      findAiDraftByContentItemId: jest
        .fn()
        .mockResolvedValue({ bodyMarkdown: AI_DRAFT_BODY }),
    } as unknown as jest.Mocked<
      Pick<
        EditorDraftRepository,
        'findByContentItemId' | 'findAiDraftByContentItemId'
      >
    >;

    const t = createReadContentTool(
      noteViewService as never,
      editorDraftRepo as never,
    );
    const result = parse(await run(t, { contentItemId: CONTENT_ID }));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.sections).toBe(3);
    expect(result.detail).toContain('【正文 · 最新已发布/已提交】');
    expect(result.detail).toContain('【我的草稿 · 未提交】');
    expect(result.detail).toContain('【AI 初稿 · Aurora 研究稿 · 只读参照】');
    expect(result.detail).toContain(PUBLISHED_BODY);
    expect(result.detail).toContain(DRAFT_BODY);
    expect(result.detail).toContain(AI_DRAFT_BODY);
  });

  it('三段都无 → status=ok，sections=0，summary 含"暂无内容"', async () => {
    const noteViewService = {
      // 节点无快照时 getById 抛异常（正常态，静默跳过）
      getById: jest.fn().mockRejectedValue(new Error('Not found')),
    } as unknown as jest.Mocked<Pick<NoteViewService, 'getById'>>;

    const editorDraftRepo = {
      findByContentItemId: jest.fn().mockResolvedValue(null),
      findAiDraftByContentItemId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<
      Pick<
        EditorDraftRepository,
        'findByContentItemId' | 'findAiDraftByContentItemId'
      >
    >;

    const t = createReadContentTool(
      noteViewService as never,
      editorDraftRepo as never,
    );
    const result = parse(await run(t, { contentItemId: CONTENT_ID }));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.sections).toBe(0);
    expect(result.summary).toContain('暂无内容');
  });
});
