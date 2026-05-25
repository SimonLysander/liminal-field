import { createProposeEditTool } from '../propose-edit.tool';

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

describe('propose_edit', () => {
  it('多处编辑:summary 报告处数,meta.count 正确', async () => {
    const tool = createProposeEditTool();
    const r = parse(
      await run(tool, {
        edits: [
          { find: '原文一', replace: '新文一', reason: '更紧凑' },
          { find: '原文二', replace: '新文二', reason: '去重复' },
        ],
      }),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.count).toBe(2);
    expect(r.summary).toContain('2');
  });
  it('空 edits:status=invalid', async () => {
    const r = parse(await run(createProposeEditTool(), { edits: [] }));
    expect(r.meta?.status).toBe('invalid');
  });
  it('过滤掉 find 或 replace 为空的项', async () => {
    const r = parse(
      await run(createProposeEditTool(), {
        edits: [
          { find: '', replace: 'x', reason: 'r' },
          { find: 'a', replace: '', reason: 'r' },
          { find: 'a', replace: 'b', reason: 'r' },
        ],
      }),
    );
    expect(r.meta?.count).toBe(1);
  });
  it('过滤掉 find 超长(>4000)的项', async () => {
    const longFind = 'x'.repeat(4001);
    const r = parse(
      await run(createProposeEditTool(), {
        edits: [
          { find: longFind, replace: 'y', reason: 'r' },
          { find: 'a', replace: 'b', reason: 'r' },
        ],
      }),
    );
    expect(r.meta?.count).toBe(1);
  });
});
