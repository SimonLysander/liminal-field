import {
  createProposeDocumentRewriteTool,
  MAX_NEW_MARKDOWN,
} from '../propose-document-rewrite.tool';
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
const make = (markdown = '# 原文\n\n这是原始正文。') =>
  createProposeDocumentRewriteTool(() => docCtx(markdown));
const hashOf = (markdown = '# 原文\n\n这是原始正文。') =>
  computeBodyHash(markdown);

describe('propose_document_rewrite', () => {
  it('正常调用(bodyHash 匹配):status=ok + meta.reason 透传', async () => {
    const r = parse(
      await run(make(), {
        newMarkdown: '# 标题\n\n这是改后的正文。',
        reason: '让结构更清晰',
        bodyHash: hashOf(),
      }),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.reason).toBe('让结构更清晰');
  });

  it('newMarkdown 空 → status=invalid', async () => {
    const r = parse(
      await run(make(), { newMarkdown: '', reason: 'r', bodyHash: hashOf() }),
    );
    expect(r.meta?.status).toBe('invalid');
  });

  it('newMarkdown 超长 → status=invalid', async () => {
    const r = parse(
      await run(make(), {
        newMarkdown: 'x'.repeat(MAX_NEW_MARKDOWN + 1),
        reason: 'r',
        bodyHash: hashOf(),
      }),
    );
    expect(r.meta?.status).toBe('invalid');
  });

  it('bodyHash 空 → status=invalid + 提示先调 get_current_draft', async () => {
    const r = parse(
      await run(make(), {
        newMarkdown: '改后',
        reason: 'r',
        bodyHash: '',
      }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.summary).toContain('get_current_draft');
  });

  it('bodyHash 与当前不符 → status=stale + detail 含最新正文 + meta 含 currentBodyHash', async () => {
    const currentMarkdown = '# 原文\n\n这是原始正文。';
    const tool = createProposeDocumentRewriteTool(() =>
      docCtx(currentMarkdown),
    );
    const r = parse(
      await run(tool, {
        newMarkdown: '改后',
        reason: '改简洁',
        bodyHash: 'deadbeefdeadbeef', // 故意不匹配
      }),
    );
    expect(r.meta?.status).toBe('stale');
    expect(r.meta?.currentBodyHash).toBe(computeBodyHash(currentMarkdown));
    expect(r.meta?.receivedBodyHash).toBe('deadbeefdeadbeef');
    expect(r.detail).toContain(currentMarkdown);
    expect(r.meta?.currentMarkdown).toBeUndefined(); // 不在 metadata 重复
  });

  it('无文档(getDocument 返回 undefined) → status=invalid', async () => {
    const tool = createProposeDocumentRewriteTool(() => undefined);
    const r = parse(
      await run(tool, {
        newMarkdown: '改后',
        reason: 'r',
        bodyHash: 'anything',
      }),
    );
    expect(r.meta?.status).toBe('invalid');
  });

  it('lazy getter:每次 execute 重读当前 markdown', async () => {
    let current = '# A';
    const tool = createProposeDocumentRewriteTool(() => docCtx(current));

    // 第一次:bodyHash = hash(A) → ok
    let r = parse(
      await run(tool, {
        newMarkdown: '改后',
        reason: 'r',
        bodyHash: computeBodyHash('# A'),
      }),
    );
    expect(r.meta?.status).toBe('ok');

    // 改了草稿
    current = '# B';

    // 用旧 bodyHash → stale
    r = parse(
      await run(tool, {
        newMarkdown: '改后',
        reason: 'r',
        bodyHash: computeBodyHash('# A'),
      }),
    );
    expect(r.meta?.status).toBe('stale');
    expect(r.meta?.currentBodyHash).toBe(computeBodyHash('# B'));
  });
});
