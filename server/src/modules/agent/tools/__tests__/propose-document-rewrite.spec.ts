import { createProposeDocumentRewriteTool, MAX_NEW_MARKDOWN } from '../propose-document-rewrite.tool';

const RUN = {} as never;
type Parsed = { summary: string; detail?: string; meta?: Record<string, unknown> };
const parse = (raw: string): Parsed => JSON.parse(raw) as Parsed;
const run = (tool: unknown, input: unknown) =>
  (tool as { execute: (i: unknown, o: unknown) => Promise<string> | string }).execute(input, RUN);


describe('propose_document_rewrite', () => {
  it('正常调用:status=ok + meta.reason 透传', async () => {
    const r = parse(
      await run(createProposeDocumentRewriteTool(), {
        newMarkdown: '# 标题\n\n这是改后的正文。',
        reason: '让结构更清晰',
      }),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.reason).toBe('让结构更清晰');
  });

  it('newMarkdown 空 → status=invalid', async () => {
    const r = parse(await run(createProposeDocumentRewriteTool(), { newMarkdown: '', reason: 'r' }));
    expect(r.meta?.status).toBe('invalid');
  });

  it(`newMarkdown 超过 ${MAX_NEW_MARKDOWN} 字符 → status=invalid`, async () => {
    const r = parse(
      await run(createProposeDocumentRewriteTool(), {
        newMarkdown: 'x'.repeat(MAX_NEW_MARKDOWN + 1),
        reason: 'r',
      }),
    );
    expect(r.meta?.status).toBe('invalid');
  });

  it('reason 空也允许 → status=ok', async () => {
    const r = parse(
      await run(createProposeDocumentRewriteTool(), { newMarkdown: '新文', reason: '' }),
    );
    expect(r.meta?.status).toBe('ok');
  });
});
