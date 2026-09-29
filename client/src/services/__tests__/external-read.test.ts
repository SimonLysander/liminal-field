import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHttpConnectionInstructions } from '../external-read';

afterEach(() => vi.restoreAllMocks());

describe('HTTP connection instructions', () => {
  it('reads the server-owned instructions from raw OpenAPI without sending login cookies', async () => {
    const instructions =
      'Use the configured public API: https://docs.example/api/v1/external/openapi.json';
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ 'openapi': '3.1.0', 'x-agent-instructions': instructions })),
      );
    const controller = new AbortController();

    await expect(getHttpConnectionInstructions(controller.signal)).resolves.toBe(instructions);
    expect(fetch).toHaveBeenCalledWith('/api/v1/external/openapi.json', {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    });
  });

  it.each([
    { openapi: '3.1.0' },
    { 'openapi': '3.1.0', 'x-agent-instructions': '' },
    { 'openapi': '3.1.0', 'x-agent-instructions': '  ' },
    { 'openapi': '3.1.0', 'x-agent-instructions': {} },
    { code: 0, data: { 'x-agent-instructions': 'Not a raw document' } },
  ])(
    'rejects missing or malformed instructions instead of copying an empty value',
    async (document) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(document)));
      await expect(getHttpConnectionInstructions()).rejects.toThrow('instructions unavailable');
    },
  );

  it('rejects an HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unavailable', { status: 503 }));
    await expect(getHttpConnectionInstructions()).rejects.toThrow('HTTP 503');
  });

  it('propagates network and JSON parsing errors', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(getHttpConnectionInstructions()).rejects.toThrow('Failed to fetch');
    fetch.mockResolvedValue(new Response('Not JSON'));
    await expect(getHttpConnectionInstructions()).rejects.toThrow();
  });
});
