import { EditorDraftRepository } from '../editor-draft.repository';

describe('EditorDraftRepository.saveAiDraftFenced', () => {
  const input = {
    contentItemId: 'ci-1',
    bodyMarkdown: '# 标题\n\n正文。',
    title: '标题',
    summary: '正文。',
    changeNote: 'learn-draft',
    savedAt: new Date('2026-07-21T00:00:00.000Z'),
  };

  it('以完整审批排序键执行条件 upsert', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'aidraft:ci-1' }),
    };
    const repository = new EditorDraftRepository(model as never, {} as never);
    const fence = '00000000000000000001:0000000001';

    await expect(repository.saveAiDraftFenced(input, fence)).resolves.toBe(
      true,
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'aidraft:ci-1',
        $or: [
          { approvalFence: { $lt: fence } },
          { approvalFence: { $exists: false } },
          { approvalFence: /^\d{4}-/ },
        ],
      },
      expect.objectContaining({
        $set: expect.objectContaining({ approvalFence: fence }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('目标已被更高排序键写入时将唯一键冲突解释为过期提交', async () => {
    const model = {
      findOneAndUpdate: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('duplicate key'), { code: 11000 }),
        ),
    };
    const repository = new EditorDraftRepository(model as never, {} as never);

    await expect(
      repository.saveAiDraftFenced(input, '00000000000000000001:0000000001'),
    ).resolves.toBe(false);
  });

  it('普通 AI 初稿写入也分配严格单调的目标屏障', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'aidraft:ci-1' }),
    };
    const writeFenceCounterRepo = { next: jest.fn().mockResolvedValue(8) };
    const repository = new EditorDraftRepository(
      model as never,
      writeFenceCounterRepo as never,
    );

    await repository.saveAiDraft(input);

    expect(model.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: 'aidraft:ci-1',
      $or: [
        {
          approvalFence: { $lt: '00000000000000000008:0000000000' },
        },
        { approvalFence: { $exists: false } },
        { approvalFence: /^\d{4}-/ },
      ],
    });
    expect(writeFenceCounterRepo.next).toHaveBeenCalledWith('draft:ci-1');
  });
});
