import { describe, expect, it, vi } from 'vitest';
import {
  hasCompletedTurn,
  recoverAgentStream,
} from '../recover-agent-stream';
import type { SessionData } from '@/services/agent';

function session(messages: Record<string, unknown>[]): SessionData {
  return {
    sessionKey: 'session-1',
    messages,
    hasMore: false,
    firstIndex: 0,
    summary: '',
    tasks: [],
    lastActiveAt: null,
    writeApprovals: {},
  };
}

describe('recoverAgentStream', () => {
  it('等待后台完成后读取包含本轮回复的权威会话', async () => {
    const getRun = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'running',
        runId: 'run-1',
        startedAt: new Date().toISOString(),
      })
      .mockResolvedValue({ status: 'idle' });
    const persisted = session([
      { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '问题' }] },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: '回答' }],
      },
    ]);

    const result = await recoverAgentStream(
      {
        sessionKey: 'session-1',
        pendingMessageId: 'user-1',
        isCancelled: () => false,
      },
      {
        getRun,
        load: vi.fn().mockResolvedValue(persisted),
        wait: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result).toBe(persisted);
    expect(getRun).toHaveBeenCalledTimes(2);
  });

  it('后台空闲但本轮没有完整回复时不会把旧会话当成成功', async () => {
    const result = await recoverAgentStream(
      {
        sessionKey: 'session-1',
        pendingMessageId: 'user-1',
        isCancelled: () => false,
      },
      {
        getRun: vi.fn().mockResolvedValue({ status: 'idle' }),
        load: vi
          .fn()
          .mockResolvedValue(
            session([
              { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '问题' }] },
            ]),
          ),
        wait: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(result).toBeUndefined();
  });
});

describe('hasCompletedTurn', () => {
  it('要求目标用户消息之后存在最终助手文本', () => {
    expect(
      hasCompletedTurn(
        [
          { id: 'old-assistant', role: 'assistant', parts: [{ type: 'text', text: '旧' }] },
          { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '新问题' }] },
        ],
        'user-1',
      ),
    ).toBe(false);

    expect(
      hasCompletedTurn(
        [
          { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '新问题' }] },
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'tool-write_draft' }],
          },
        ],
        'user-1',
      ),
    ).toBe(false);

    expect(
      hasCompletedTurn(
        [
          { id: 'user-1', role: 'user', parts: [{ type: 'text', text: '新问题' }] },
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [
              { type: 'tool-write_draft' },
              { type: 'text', text: '草稿已经写好。' },
            ],
          },
        ],
        'user-1',
      ),
    ).toBe(true);
  });
});
