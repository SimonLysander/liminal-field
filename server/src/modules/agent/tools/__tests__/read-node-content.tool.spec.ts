/**
 * read-node-content.tool（read_content）单测。
 *
 * 覆盖：
 *   1. 两段都有 → status=ok，sections=2，detail 含正文 + 用户草稿(不含 Aurora AI 初稿)
 *   2. 两段都无 → status=ok，sections=0，summary 含"暂无内容"
 *
 * 注:read_content 只返回真实内容(已发布 + 用户草稿),不返回 Aurora 自己的 AI 初稿。
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

describe('read-node-content.tool', () => {
  it('两段都有 → status=ok，sections=2，detail 含正文 + 用户草稿，不含 AI 初稿', async () => {
    const noteViewService = {
      getById: jest.fn().mockResolvedValue({ bodyMarkdown: PUBLISHED_BODY }),
    } as unknown as jest.Mocked<Pick<NoteViewService, 'getById'>>;

    const editorDraftRepo = {
      findByContentItemId: jest
        .fn()
        .mockResolvedValue({ bodyMarkdown: DRAFT_BODY }),
    } as unknown as jest.Mocked<
      Pick<EditorDraftRepository, 'findByContentItemId'>
    >;

    const t = createReadContentTool(
      noteViewService as never,
      editorDraftRepo as never,
    );
    const result = parse(await run(t, { contentItemId: CONTENT_ID }));

    expect(result.meta.status).toBe('ok');
    expect(result.meta.sections).toBe(2);
    expect(result.detail).toContain('【正文 · 最新已发布/已提交】');
    expect(result.detail).toContain('【我的草稿 · 未提交】');
    expect(result.detail).not.toContain('AI 初稿');
    expect(result.detail).toContain(PUBLISHED_BODY);
    expect(result.detail).toContain(DRAFT_BODY);
  });

  it('两段都无 → status=ok，sections=0，summary 含"暂无内容"', async () => {
    const noteViewService = {
      // 节点无快照时 getById 抛异常（正常态，静默跳过）
      getById: jest.fn().mockRejectedValue(new Error('Not found')),
    } as unknown as jest.Mocked<Pick<NoteViewService, 'getById'>>;

    const editorDraftRepo = {
      findByContentItemId: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<
      Pick<EditorDraftRepository, 'findByContentItemId'>
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
