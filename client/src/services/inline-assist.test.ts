import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { streamInlineAssist } from './inline-assist';

const textStream = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });

describe('streamInlineAssist', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits streamed text chunks in order', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(textStream(['你', '好']), { status: 200 }),
    );
    const chunks: string[] = [];

    await streamInlineAssist(
      { beforeText: '前文' },
      { onChunk: (chunk) => chunks.push(chunk) },
    );

    expect(chunks.join('')).toBe('你好');
  });

  it('sends marked document markdown to the stream endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(textStream(['ok']), { status: 200 }),
    );

    await streamInlineAssist(
      {
        documentMarkdown: '# 标题\n\n<!-- INLINE_ASSIST_CURSOR -->',
      },
      { onChunk: vi.fn() },
    );

    const body = JSON.parse(
      fetchMock.mock.calls[0]?.[1]?.body as string,
    ) as { documentMarkdown?: string };
    expect(body.documentMarkdown).toContain('<!-- INLINE_ASSIST_CURSOR -->');
  });

  it('falls back to legacy context fields when old backend rejects documentMarkdown', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: ['property documentMarkdown should not exist'],
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(new Response(textStream(['ok']), { status: 200 }));
    const chunks: string[] = [];

    await streamInlineAssist(
      {
        documentMarkdown:
          '# 标题\n\n<!-- INLINE_ASSIST_SELECTION_START -->选中文本<!-- INLINE_ASSIST_SELECTION_END -->\n\n后文',
        instruction: '改写',
      },
      { onChunk: (chunk) => chunks.push(chunk) },
    );

    const retryBody = JSON.parse(
      fetchMock.mock.calls[1]?.[1]?.body as string,
    ) as {
      documentMarkdown?: string;
      beforeText?: string;
      selectedText?: string;
      afterText?: string;
    };
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks.join('')).toBe('ok');
    expect(retryBody.documentMarkdown).toBeUndefined();
    expect(retryBody.beforeText).toContain('# 标题');
    expect(retryBody.selectedText).toBe('选中文本');
    expect(retryBody.afterText).toContain('后文');
  });

  it('uses backend error messages for non-2xx responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ msg: '缺少可续写的上下文' }), {
        status: 400,
      }),
    );

    await expect(
      streamInlineAssist({ beforeText: '' }, { onChunk: vi.fn() }),
    ).rejects.toMatchObject({
      code: 400,
      message: '缺少可续写的上下文',
    });
  });

  it('preserves AbortError instead of translating it to a network error', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError);

    await expect(
      streamInlineAssist({ beforeText: '前文' }, { onChunk: vi.fn() }),
    ).rejects.toBe(abortError);
  });
});
