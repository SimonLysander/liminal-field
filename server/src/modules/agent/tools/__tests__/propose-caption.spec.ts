import { createProposeCaptionTool } from '../propose-caption.tool';
import type { GalleryContext } from '../gallery-context';

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

const ctx: GalleryContext = {
  contentItemId: 'g1',
  title: 't',
  prose: '',
  photos: [{ index: 0, fileName: 'a.webp', caption: '', tags: {} }],
};

describe('propose_caption', () => {
  it('已知 fileName + 非空文案 → ok,meta 带 fileName+caption', async () => {
    const r = parse(
      await run(
        createProposeCaptionTool(() => ctx),
        { fileName: 'a.webp', caption: '樱花满枝' },
      ),
    );
    expect(r.meta).toMatchObject({
      status: 'ok',
      fileName: 'a.webp',
      caption: '樱花满枝',
    });
  });

  it('未知 fileName → not_found', async () => {
    const r = parse(
      await run(
        createProposeCaptionTool(() => ctx),
        { fileName: 'zzz', caption: 'x' },
      ),
    );
    expect(r.meta?.status).toBe('not_found');
  });

  it('空文案 → invalid', async () => {
    const r = parse(
      await run(
        createProposeCaptionTool(() => ctx),
        { fileName: 'a.webp', caption: '  ' },
      ),
    );
    expect(r.meta?.status).toBe('invalid');
  });
});
