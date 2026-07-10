import { PendingWriteRepository } from './pending-write.repository';

describe('PendingWriteRepository.findStatusesBySessionKey', () => {
  it("returns only a session's persisted approval statuses, keyed by tool call id", async () => {
    const model = {
      find: jest.fn().mockResolvedValue([
        { _id: 'call-pending', status: 'pending' },
        { _id: 'call-approved', status: 'approved' },
        { _id: 'call-rejected', status: 'rejected' },
      ]),
    };
    const repository = new PendingWriteRepository(model as never);

    await expect(
      repository.findStatusesBySessionKey('learn-ci:chat:1'),
    ).resolves.toEqual({
      'call-pending': 'pending',
      'call-approved': 'approved',
      'call-rejected': 'rejected',
    });
    expect(model.find).toHaveBeenCalledWith(
      { sessionKey: 'learn-ci:chat:1' },
      { _id: 1, status: 1 },
    );
  });
});
