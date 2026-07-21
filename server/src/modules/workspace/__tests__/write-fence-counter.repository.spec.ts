import { WriteFenceCounterRepository } from '../write-fence-counter.repository';

describe('WriteFenceCounterRepository', () => {
  it('按目标使用 Mongo 原子自增并返回更新后的序号', async () => {
    const model = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ sequence: 42 }),
    };
    const repository = new WriteFenceCounterRepository(model as never);

    await expect(repository.next('draft:ci-1')).resolves.toBe(42);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'draft:ci-1' },
      { $inc: { sequence: 1 } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
  });
});
