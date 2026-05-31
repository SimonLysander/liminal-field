import { createReadCollectionEntryTool } from '../read-collection-entry.tool';
import type { DocumentContext } from '../get-current-document.tool';

const RUN = {} as never;
type Parsed = {
  summary: string;
  detail?: string;
  meta?: Record<string, unknown>;
};
const parse = (raw: string): Parsed => JSON.parse(raw) as Parsed;
const run = (tool: unknown, input: unknown) =>
  (
    tool as { execute: (i: unknown, o: unknown) => Promise<string> | string }
  ).execute(input, RUN);

const doc = (contentItemId: string): DocumentContext => ({
  contentItemId,
  title: '当前节点',
  bodyMarkdown: 'x',
});

describe('read_collection_entry', () => {
  it('正常读同集兄弟节点:usePublished=false,返回标题+正文', async () => {
    const reader = {
      getEntryDetail: jest
        .fn()
        .mockResolvedValue({ title: '认识世界', bodyMarkdown: '世界是…' }),
    };
    const r = parse(
      await run(
        createReadCollectionEntryTool(() => doc('ci_x:e_self'), reader),
        { nodeId: 'e_other' },
      ),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.detail).toBe('世界是…');
    expect(r.summary).toContain('认识世界');
    // 关键:用文集 id + 目标 nodeId + usePublished=false(最新已提交,不限发布)
    expect(reader.getEntryDetail).toHaveBeenCalledWith(
      'ci_x',
      'e_other',
      false,
    );
  });

  it('当前文档不是文集子节点(无冒号)→ invalid', async () => {
    const reader = { getEntryDetail: jest.fn() };
    const r = parse(
      await run(
        createReadCollectionEntryTool(() => doc('ci_plain_note'), reader),
        { nodeId: 'e_other' },
      ),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(reader.getEntryDetail).not.toHaveBeenCalled();
  });

  it('请求的就是当前正在编辑的节点 → invalid,提示用 get_current_draft', async () => {
    const reader = { getEntryDetail: jest.fn() };
    const r = parse(
      await run(
        createReadCollectionEntryTool(() => doc('ci_x:e_self'), reader),
        { nodeId: 'e_self' },
      ),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.summary).toContain('get_current_draft');
    expect(reader.getEntryDetail).not.toHaveBeenCalled();
  });

  it('节点不存在(reader 抛错)→ not_found', async () => {
    const reader = {
      getEntryDetail: jest.fn().mockRejectedValue(new Error('not found')),
    };
    const r = parse(
      await run(
        createReadCollectionEntryTool(() => doc('ci_x:e_self'), reader),
        { nodeId: 'e_ghost' },
      ),
    );
    expect(r.meta?.status).toBe('not_found');
  });
});
