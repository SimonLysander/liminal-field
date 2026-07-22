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
