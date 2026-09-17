import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelActiveRun } from '../agent';

describe('cancelActiveRun', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('按会话键和运行 ID 精确取消当前运行', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ code: 0, msg: 'ok', data: { cancelled: true } }),
        { status: 200 },
      ),
    );

    await expect(
      cancelActiveRun('learn:node:1', 'run id/1'),
    ).resolves.toEqual({ cancelled: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/agent/runs/learn%3Anode%3A1/active?runId=run%20id%2F1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
