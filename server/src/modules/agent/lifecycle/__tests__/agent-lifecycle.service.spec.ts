import { AgentLifecycle } from '../agent-lifecycle.service';

function createLifecycle(
  messages: Record<string, unknown>[],
  persistedApprovals: Record<
    string,
    {
      status: 'pending' | 'approved' | 'rejected' | 'superseded';
      resolvedAt: Date | null;
    }
  >,
) {
  const pendingWriteRepo = {
    findApprovalsBySessionKey: jest.fn().mockResolvedValue(persistedApprovals),
  };
  const lifecycle = new AgentLifecycle(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { findSession: jest.fn().mockResolvedValue(null) } as never,
    {
      getAllMessages: jest.fn().mockResolvedValue(messages),
      findLatestSeg: jest.fn().mockResolvedValue(null),
    } as never,
    pendingWriteRepo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { lifecycle, pendingWriteRepo };
}

describe('AgentLifecycle.onSessionLoad', () => {
  it('returns persisted decisions and marks only missing historical cards expired', async () => {
    const { lifecycle, pendingWriteRepo } = createLifecycle(
      [
        {
          parts: [
            {
              toolCallId: 'still-persisted',
              output: { meta: { status: 'pending_approval' } },
            },
            {
              output: JSON.stringify({
                meta: { status: 'pending_approval', toolCallId: 'ttl-cleared' },
              }),
            },
          ],
        },
      ],
      {
        'still-persisted': {
          status: 'approved',
          resolvedAt: new Date('2026-07-21T01:02:03.000Z'),
        },
      },
    );

    const result = await lifecycle.onSessionLoad('learn-ci:chat:1');

    expect(result.writeApprovals).toEqual({
      'still-persisted': {
        status: 'approved',
        resolvedAt: new Date('2026-07-21T01:02:03.000Z'),
      },
      'ttl-cleared': { status: 'expired', resolvedAt: null },
    });
    expect(result.writeApprovalStatuses).toEqual({
      'still-persisted': 'approved',
      'ttl-cleared': 'expired',
    });
    expect(pendingWriteRepo.findApprovalsBySessionKey).toHaveBeenCalledWith(
      'learn-ci:chat:1',
      ['still-persisted', 'ttl-cleared'],
    );
  });
});

describe('AgentLifecycle.onBeforeChat', () => {
  it('passes the current request, recent conversation and scene to sub-agent assembly', async () => {
    const assemble = jest.fn().mockReturnValue({});
    const getRecentMessages = jest.fn();
    const lifecycle = new AgentLifecycle(
      {} as never,
      { loadCore: jest.fn().mockResolvedValue([]) } as never,
      { buildSystemPrompt: jest.fn().mockReturnValue('system') } as never,
      { assemble } as never,
      {} as never,
      {
        getOwnerProfile: jest
          .fn()
          .mockResolvedValue({ name: '', birthday: '', bio: '' }),
      } as never,
      {
        findSession: jest
          .fn()
          .mockResolvedValue({ content: '持续研究波动率', tasks: [] }),
      } as never,
      {
        getRecentMessages,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findCurrentView: jest.fn().mockResolvedValue(null),
        findRecent: jest.fn().mockResolvedValue([]),
      } as never,
      { findByIds: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
    );

    await lifecycle.onBeforeChat(
      {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: '检查这节有没有遗漏' }],
        },
        entryContext: {
          source: 'agent-page',
          sessionKey: 'session-1',
          selectedText: 'ATR 的定义',
          document: {
            contentItemId: 'note-1',
            title: '波动率止损',
            bodyMarkdown: '正文',
          },
        },
      },
      {},
      Promise.resolve([
        {
          role: 'user',
          parts: [{ type: 'text', text: '先解释 ATR' }],
        },
        {
          role: 'assistant',
          parts: [{ type: 'text', text: '再看止损应用' }],
        },
      ]),
    );

    expect(assemble).toHaveBeenCalledWith(
      expect.objectContaining({
        subAgentContext: {
          currentUserRequest: '检查这节有没有遗漏',
          recentConversation: '用户：先解释 ATR\n\n主智能体：再看止损应用',
          sessionSummary: '持续研究波动率',
          sceneContext: '入口：agent-page\n\n用户选中的内容：\nATR 的定义',
        },
      }),
      undefined,
      undefined,
      undefined,
    );
    expect(getRecentMessages).not.toHaveBeenCalled();
  });
});

describe('AgentLifecycle.onSessionDelete', () => {
  it('并行清理会话消息与持久化审批载荷', async () => {
    const session = { delete: jest.fn().mockResolvedValue(undefined) };
    const pendingWriteRepo = {
      deleteBySessionKey: jest.fn().mockResolvedValue(2),
    };
    const lifecycle = new AgentLifecycle(
      session as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      pendingWriteRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await lifecycle.onSessionDelete('learn-ci:chat:1');

    expect(session.delete).toHaveBeenCalledWith('learn-ci:chat:1');
    expect(pendingWriteRepo.deleteBySessionKey).toHaveBeenCalledWith(
      'learn-ci:chat:1',
    );
  });
});
