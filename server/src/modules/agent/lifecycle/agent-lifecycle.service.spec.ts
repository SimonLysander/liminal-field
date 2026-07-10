import { AgentLifecycle } from './agent-lifecycle.service';

function createLifecycle(
  messages: Record<string, unknown>[],
  persistedStatuses: Record<string, 'pending' | 'approved' | 'rejected'>,
) {
  return new AgentLifecycle(
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
    {
      findStatusesBySessionKey: jest.fn().mockResolvedValue(persistedStatuses),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('AgentLifecycle.onSessionLoad', () => {
  it('returns persisted approval states and marks TTL-cleared historical cards expired', async () => {
    const lifecycle = createLifecycle(
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
      { 'still-persisted': 'approved' },
    );

    const result = await lifecycle.onSessionLoad('learn-ci:chat:1');

    expect(result.writeApprovalStatuses).toEqual({
      'still-persisted': 'approved',
      'ttl-cleared': 'expired',
    });
  });
});
