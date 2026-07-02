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
