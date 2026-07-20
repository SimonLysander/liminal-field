/**
 * read-node-content.tool（read_content）单测。
 *
 * 覆盖：
 *   1. 草稿和已提交正文都有 → 仅返回草稿，且不查询已提交正文
 *   2. 空草稿也是当前有效版本，不回退到旧正文
 *   3. 无草稿时 → 回退返回已提交正文
 *   4. 两段都无 → status=ok，summary 含"暂无内容"
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
const COMMITTED_BODY = '已提交的正文内容';
const DRAFT_BODY = '用户草稿内容';

describe('read-node-content.tool', () => {
  it('草稿和已提交正文都有 → 仅返回草稿，且不查询已提交正文', async () => {
    const noteViewService = {
      getById: jest.fn().mockResolvedValue({ bodyMarkdown: COMMITTED_BODY }),
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
    expect(result.meta.source).toBe('draft');
    expect(result.detail).toContain('【当前编辑草稿】');
    expect(result.detail).toContain(DRAFT_BODY);
    expect(result.detail).not.toContain(COMMITTED_BODY);
    expect(noteViewService.getById).not.toHaveBeenCalled();
  });

  it('无草稿时 → 回退返回已提交正文', async () => {
    const noteViewService = {
      getById: jest.fn().mockResolvedValue({ bodyMarkdown: COMMITTED_BODY }),
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

    expect(result.meta.source).toBe('committed');
    expect(result.detail).toContain('【已提交正文】');
    expect(result.detail).toContain(COMMITTED_BODY);
  });

  it('空草稿也是当前有效版本，不回退到旧正文', async () => {
    const noteViewService = {
      getById: jest.fn().mockResolvedValue({ bodyMarkdown: COMMITTED_BODY }),
    } as unknown as jest.Mocked<Pick<NoteViewService, 'getById'>>;
    const editorDraftRepo = {
      findByContentItemId: jest.fn().mockResolvedValue({ bodyMarkdown: '' }),
    } as unknown as jest.Mocked<
      Pick<EditorDraftRepository, 'findByContentItemId'>
    >;

    const t = createReadContentTool(
      noteViewService as never,
      editorDraftRepo as never,
    );
    const result = parse(await run(t, { contentItemId: CONTENT_ID }));

    expect(result.meta.source).toBe('draft');
    expect(result.detail).toBe('【当前编辑草稿】\n');
    expect(noteViewService.getById).not.toHaveBeenCalled();
  });

  it('两段都无 → status=ok，source=none，summary 含"暂无内容"', async () => {
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
    expect(result.meta.source).toBe('none');
    expect(result.summary).toContain('暂无内容');
  });
});
