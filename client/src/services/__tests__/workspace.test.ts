import { afterEach, describe, expect, it, vi } from 'vitest';

import { notesApi } from '../workspace';

describe('notesApi version selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('explicitly requests the published view', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 0, msg: 'ok', data: { title: 'Published' } }),
        ),
      );

    await expect(notesApi.getPublicById('ci_note')).resolves.toEqual({
      title: 'Published',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/spaces/notes/items/ci_note?visibility=public',
      expect.any(Object),
    );
  });

  it('keeps explicit latest-version reads for the admin editor', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: 0, msg: 'ok', data: { title: 'Latest' } }),
        ),
      );

    await expect(
      notesApi.getById('ci_note', { visibility: 'all' }),
    ).resolves.toEqual({ title: 'Latest' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/spaces/notes/items/ci_note?visibility=all',
      expect.any(Object),
    );
  });
});
