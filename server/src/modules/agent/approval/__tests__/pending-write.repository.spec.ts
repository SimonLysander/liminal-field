import { PendingWriteRepository } from '../pending-write.repository';
import { PENDING_WRITE_TTL_MS } from '../pending-write.entity';

describe('PendingWriteRepository.findApprovalsBySessionKey', () => {
  it("returns only a session's persisted approval status and resolution time", async () => {
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    const rows = [
      { _id: 'call-pending', status: 'pending', resolvedAt: null },
      {
        _id: 'call-expired',
        status: 'pending',
        expiresAt: new Date('2026-07-20T00:00:00.000Z'),
      },
      { _id: 'call-committing', status: 'committing' },
      { _id: 'call-approved', status: 'approved', resolvedAt },
      { _id: 'call-rejected', status: 'rejected', resolvedAt },
      { _id: 'call-superseded', status: 'superseded', resolvedAt },
    ];
    const lean = jest.fn().mockResolvedValue(rows);
    const model = {
      find: jest.fn().mockReturnValue({ lean }),
    };
    const repository = new PendingWriteRepository(model as never, {} as never);

    await expect(
      repository.findApprovalsBySessionKey(
        'learn-ci:chat:1',
        [
          'call-pending',
          'call-expired',
          'call-committing',
          'call-approved',
          'call-rejected',
          'call-superseded',
        ],
        new Date('2026-07-21T00:00:00.000Z'),
      ),
    ).resolves.toEqual({
      'call-pending': { status: 'pending', resolvedAt: null },
      'call-expired': { status: 'expired', resolvedAt: null },
      'call-committing': { status: 'pending', resolvedAt: null },
      'call-approved': { status: 'approved', resolvedAt },
      'call-rejected': { status: 'rejected', resolvedAt },
      'call-superseded': { status: 'superseded', resolvedAt },
    });
    expect(model.find).toHaveBeenCalledWith(
      {
        sessionKey: 'learn-ci:chat:1',
        _id: {
          $in: [
            'call-pending',
            'call-expired',
            'call-committing',
            'call-approved',
            'call-rejected',
            'call-superseded',
          ],
        },
      },
      { _id: 1, status: 1, expiresAt: 1, resolvedAt: 1 },
    );
    expect(lean).toHaveBeenCalledTimes(1);
  });
});

describe('PendingWriteRepository approval lease', () => {
  it('claim 与 complete 都用状态条件保护原子迁移', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockResolvedValue({
        commitVersion: 3,
        fenceSequence: 9,
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const repository = new PendingWriteRepository(model as never, {} as never);
    const now = new Date('2026-07-21T00:00:00.000Z');

    await expect(
      repository.claimApproval('call-1', 'token-1', now),
    ).resolves.toEqual({
      commitVersion: 3,
      fenceSequence: 9,
    });
    await expect(
      repository.completeApproval('call-1', 'token-1', now),
    ).resolves.toBe(true);
    expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: 'call-1',
      status: 'pending',
      expiresAt: { $gt: now },
    });
    expect(model.findOneAndUpdate.mock.calls[0][1]).toMatchObject({
      $inc: { commitVersion: 1 },
      $set: {
        status: 'committing',
        commitToken: 'token-1',
        expiresAt: new Date(now.getTime() + PENDING_WRITE_TTL_MS),
      },
    });
    expect(model.updateOne.mock.calls[0][0]).toEqual({
      _id: 'call-1',
      status: 'committing',
      commitToken: 'token-1',
    });
    expect(model.updateOne.mock.calls[0][1]).toMatchObject({
      $set: { status: 'approved' },
      $unset: { expiresAt: 1, payload: 1, preview: 1 },
    });
  });

  it('只回收超过租约截止时间的 committing', async () => {
    const model = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const repository = new PendingWriteRepository(model as never, {} as never);
    const staleBefore = new Date('2026-07-21T00:00:00.000Z');

    await repository.reopenStaleApproval('call-1', staleBefore);

    expect(model.updateOne.mock.calls[0][0]).toEqual({
      _id: 'call-1',
      status: 'committing',
      commitStartedAt: { $lte: staleBefore },
    });
  });

  it('被新内容取代后仅保留轻量终态', async () => {
    const model = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const repository = new PendingWriteRepository(model as never, {} as never);
    const now = new Date('2026-07-21T00:00:00.000Z');

    await expect(
      repository.completeSuperseded('call-1', 'token-1', now),
    ).resolves.toBe(true);
    expect(model.updateOne.mock.calls[0][1]).toMatchObject({
      $set: { status: 'superseded' },
      $unset: { expiresAt: 1, payload: 1, preview: 1 },
    });
  });

  it('claim 升级前记录时补分配目标 fenceSequence', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockResolvedValue({
        commitVersion: 1,
        toolName: 'write_draft',
        targetContentItemId: 'ci-legacy',
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const writeFenceCounterRepo = { next: jest.fn().mockResolvedValue(21) };
    const repository = new PendingWriteRepository(
      model as never,
      writeFenceCounterRepo as never,
    );

    await expect(
      repository.claimApproval('call-legacy', 'token-1', new Date()),
    ).resolves.toEqual({ commitVersion: 1, fenceSequence: 21 });
    expect(writeFenceCounterRepo.next).toHaveBeenCalledWith('draft:ci-legacy');
    expect(model.updateOne).toHaveBeenCalledWith(
      {
        _id: 'call-legacy',
        status: 'committing',
        commitToken: 'token-1',
      },
      { $set: { fenceSequence: 21 } },
    );
  });
});

describe('PendingWriteRepository.stash', () => {
  it('同一 toolCallId 重放时只初始化一次，不重置现有状态或提交租约', async () => {
    const model = {
      exists: jest.fn().mockResolvedValue(false),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    const writeFenceCounterRepo = { next: jest.fn().mockResolvedValue(12) };
    const repository = new PendingWriteRepository(
      model as never,
      writeFenceCounterRepo as never,
    );
    const now = new Date('2026-07-21T00:00:00.000Z');

    await repository.stash({
      toolCallId: 'call-1',
      sessionKey: 'session-1',
      toolName: 'write_draft',
      targetContentItemId: 'ci-1',
      payload: { markdown: '# 标题' },
      now,
    });

    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      'call-1',
      {
        $setOnInsert: expect.objectContaining({
          status: 'pending',
          commitVersion: 0,
          fenceSequence: 12,
          createdAt: now,
          expiresAt: new Date(now.getTime() + PENDING_WRITE_TTL_MS),
        }),
      },
      { upsert: true },
    );
    expect(model.findByIdAndUpdate.mock.calls[0][1]).not.toHaveProperty('$set');
  });

  it('并发首次暂存命中同一 _id 时按幂等成功处理', async () => {
    const model = {
      findByIdAndUpdate: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('duplicate key'), { code: 11000 }),
        ),
      exists: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    };
    const repository = new PendingWriteRepository(
      model as never,
      { next: jest.fn().mockResolvedValue(12) } as never,
    );

    await expect(
      repository.stash({
        toolCallId: 'call-1',
        sessionKey: 'session-1',
        toolName: 'write_draft',
        payload: { markdown: '# 标题' },
        now: new Date('2026-07-21T00:00:00.000Z'),
      }),
    ).resolves.toBeUndefined();
    expect(model.exists).toHaveBeenCalledWith({ _id: 'call-1' });
  });

  it('reject removes the expiry marker so the terminal decision remains queryable', async () => {
    const model = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const repository = new PendingWriteRepository(model as never, {} as never);
    const now = new Date('2026-07-21T00:00:00.000Z');

    await expect(repository.reject('call-1', now)).resolves.toBe(true);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: 'call-1', status: 'pending', expiresAt: { $gt: now } },
      {
        $set: { status: 'rejected', resolvedAt: now },
        $unset: { expiresAt: 1, payload: 1, preview: 1 },
      },
    );
  });
});

describe('PendingWriteRepository.deleteBySessionKey', () => {
  it('删除会话时一并删除其审批载荷', async () => {
    const model = {
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    };
    const repository = new PendingWriteRepository(model as never, {} as never);

    await expect(
      repository.deleteBySessionKey('learn-ci:chat:1'),
    ).resolves.toBe(3);
    expect(model.deleteMany).toHaveBeenCalledWith({
      sessionKey: 'learn-ci:chat:1',
    });
  });
});
