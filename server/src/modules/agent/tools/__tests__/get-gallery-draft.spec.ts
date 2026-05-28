import { createGetGalleryDraftTool } from '../get-gallery-draft.tool';
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
  title: '春日',
  prose: '随笔正文在此',
  photos: [
    { index: 0, fileName: 'a.webp', caption: '樱花', tags: { 光圈: 'f/2.8' } },
    { index: 1, fileName: 'b.webp', caption: '', tags: {} },
  ],
};

describe('get_current_draft（画廊版）', () => {
  it('返回随笔 + 照片清单(含 fileName/caption/tags),meta.status=ok', async () => {
    const r = parse(
      await run(
        createGetGalleryDraftTool(() => ctx),
        {},
      ),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.photoCount).toBe(2);
    expect(r.detail).toContain('a.webp');
    expect(r.detail).toContain('樱花');
    expect(r.detail).toContain('随笔正文在此');
    expect(r.detail).toContain('f/2.8');
  });

  it('无草稿 → not_found', async () => {
    const r = parse(
      await run(
        createGetGalleryDraftTool(() => undefined),
        {},
      ),
    );
    expect(r.meta?.status).toBe('not_found');
  });
});
