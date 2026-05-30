import { createViewPhotosTool } from '../view-photos.tool';
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

describe('view_photos', () => {
  it('已知 fileName 进 requested,未知的进 missing', async () => {
    const r = parse(
      await run(
        createViewPhotosTool(() => ctx),
        { fileNames: ['a.webp', 'zzz.webp'] },
      ),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.requested).toEqual(['a.webp']);
    expect(r.meta?.missing).toEqual(['zzz.webp']);
  });

  it('无草稿 → not_found', async () => {
    const r = parse(
      await run(
        createViewPhotosTool(() => undefined),
        { fileNames: ['a.webp'] },
      ),
    );
    expect(r.meta?.status).toBe('not_found');
  });
});
