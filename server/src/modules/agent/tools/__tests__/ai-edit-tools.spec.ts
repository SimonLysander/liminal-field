import { createRewriteSelectionTool } from '../rewrite-selection.tool';
import { createRewriteDocumentTool } from '../rewrite-document.tool';

const RUN = {} as never;
type Parsed = { summary: string; detail?: string; meta?: Record<string, unknown> };
const parse = (raw: string): Parsed => JSON.parse(raw) as Parsed;
const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, o: unknown) => Promise<string> | string }).execute(input, RUN);

const MAX = 60_000;

describe.each([
  ['rewrite_selection', createRewriteSelectionTool],
  ['rewrite_document', createRewriteDocumentTool],
])('%s', (name, factory) => {
  it('正常调用:status=ok + meta 包含 reason', async () => {
    const r = parse(await run(factory(), { newMarkdown: '改后的新内容。', reason: '更紧凑' }));
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.reason).toBe('更紧凑');
  });
  it('newMarkdown 空:status=invalid', async () => {
    const r = parse(await run(factory(), { newMarkdown: '', reason: 'r' }));
    expect(r.meta?.status).toBe('invalid');
  });
  it(`newMarkdown 超过 ${MAX}:status=invalid`, async () => {
    const r = parse(await run(factory(), { newMarkdown: 'x'.repeat(MAX + 1), reason: 'r' }));
    expect(r.meta?.status).toBe('invalid');
  });
  it('reason 空也允许(给默认空字符串)', async () => {
    const r = parse(await run(factory(), { newMarkdown: '新文', reason: '' }));
    expect(r.meta?.status).toBe('ok');
  });
});
