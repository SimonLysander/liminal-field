import { createGetCurrentDraftTool } from '../get-current-document.tool';
import { computeBodyHash } from '../body-hash.utils';

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

const docCtx = (bodyMarkdown: string) => ({
  contentItemId: 'ci_test',
  title: '测试文档',
  bodyMarkdown,
});

describe('get_current_draft', () => {
  it('正常调用:返回 bodyHash + body 含 cat -n 行号', async () => {
    const body = '独处并不可怕。\n坐下来,什么都不做。';
    const r = parse(
      await run(
        createGetCurrentDraftTool(() => docCtx(body)),
        {},
      ),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.bodyHash).toBe(computeBodyHash(body));
    expect(r.detail).toContain('   1\t独处并不可怕。');
    expect(r.detail).toContain('   2\t坐下来,什么都不做。');
  });

  it('lazy getter:每次 execute 重新调一次 getter', async () => {
    let count = 0;
    const tool = createGetCurrentDraftTool(() => {
      count++;
      return docCtx('内容');
    });
    await run(tool, {});
    await run(tool, {});
    expect(count).toBe(2);
  });

  it('getter 返回 undefined → status=not_found,无 bodyHash', async () => {
    const r = parse(
      await run(
        createGetCurrentDraftTool(() => undefined),
        {},
      ),
    );
    expect(r.meta?.status).toBe('not_found');
    expect(r.meta?.bodyHash).toBeUndefined();
  });

  it('bodyHash 随正文变化而变', async () => {
    const a = parse(
      await run(
        createGetCurrentDraftTool(() => docCtx('A')),
        {},
      ),
    );
    const b = parse(
      await run(
        createGetCurrentDraftTool(() => docCtx('B')),
        {},
      ),
    );
    expect(a.meta?.bodyHash).not.toBe(b.meta?.bodyHash);
  });

  it('offset/limit chunk 读:hasMore + nextOffset', async () => {
    const longBody = '一'.repeat(7000);
    const r = parse(
      await run(
        createGetCurrentDraftTool(() => docCtx(longBody)),
        {
          offset: 0,
          limit: 6000,
        },
      ),
    );
    expect(r.meta?.hasMore).toBe(true);
    expect(r.meta?.nextOffset).toBe(6000);
  });
});
