import { AgentMemoryObservationRepository } from '../agent-memory-observation.repository';

describe('AgentMemoryObservationRepository.appendManyIdempotent', () => {
  it('按 toolCallId 与数组序号生成稳定幂等键并使用 upsert', async () => {
    const observationModel = {
      updateOne: jest
        .fn()
        .mockResolvedValue({ modifiedCount: 0, upsertedCount: 1 }),
    };
    const repository = new AgentMemoryObservationRepository(
      observationModel as never,
      {} as never,
    );

    await repository.appendManyIdempotent('call-1', [
      { topic: 'method', observation: '先建立模型。', sessionKey: 's1' },
      { topic: 'aesthetic', observation: '偏好克制表达。' },
    ]);

    expect(observationModel.updateOne).toHaveBeenCalledTimes(2);
    expect(observationModel.updateOne.mock.calls[0][0]).toEqual({
      idempotencyKey: 'call-1:0',
    });
    expect(observationModel.updateOne.mock.calls[1][0]).toEqual({
      idempotencyKey: 'call-1:1',
    });
    expect(observationModel.updateOne.mock.calls[0][2]).toEqual({
      upsert: true,
    });
  });

  it('并发重复键已存在时按幂等成功处理', async () => {
    const observationModel = {
      updateOne: jest
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('duplicate key'), { code: 11000 }),
        ),
      exists: jest.fn().mockResolvedValue(true),
    };
    const repository = new AgentMemoryObservationRepository(
      observationModel as never,
      {} as never,
    );

    await expect(
      repository.appendManyIdempotent('call-1', [
        { topic: 'method', observation: '先建立模型。' },
      ]),
    ).resolves.toBeUndefined();
    expect(observationModel.exists).toHaveBeenCalledWith({
      idempotencyKey: 'call-1:0',
    });
  });
});
