import {
  buildExternalCacheId,
  stableStringify,
  ExternalCacheRepository,
  type ExternalCacheKey,
} from './external-cache.repository';

describe('ExternalCacheRepository helpers', () => {
  it('stableStringify 对对象 key 顺序稳定', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"b":2}',
    );
  });

  it('buildExternalCacheId 按 namespace + operation + key 生成稳定 id', () => {
    const a = buildExternalCacheId('web', 'fetch', {
      url: 'https://a',
      max: 1,
    });
    const b = buildExternalCacheId('web', 'fetch', {
      max: 1,
      url: 'https://a',
    });
    const c = buildExternalCacheId('web', 'search', {
      max: 1,
      url: 'https://a',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('ExternalCacheRepository', () => {
  const key: ExternalCacheKey = {
    namespace: 'web',
    operation: 'fetch',
    key: { url: 'https://example.com' },
  };

  function modelStub() {
    return {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
  }

  it('getFresh 命中过期时间之后的 ok 记录', async () => {
    const model = modelStub();
    const doc = { payload: { markdown: 'ok' } };
    model.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const repo = new ExternalCacheRepository(model as never);

    await expect(repo.getFresh(key, new Date('2026-01-01'))).resolves.toBe(doc);
    expect(model.findOne).toHaveBeenCalledWith({
      _id: buildExternalCacheId(key.namespace, key.operation, key.key),
      expiresAt: { $gt: new Date('2026-01-01') },
    });
  });

  it('setOk upsert 成功 payload', async () => {
    const model = modelStub();
    model.findOneAndUpdate.mockResolvedValue(undefined);
    const repo = new ExternalCacheRepository(model as never);
    const now = new Date('2026-01-01T00:00:00Z');
    const expiresAt = new Date('2026-01-02T00:00:00Z');

    await repo.setOk(key, { value: 1 }, { provider: 'direct' }, expiresAt, now);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: buildExternalCacheId(key.namespace, key.operation, key.key) },
      expect.objectContaining({
        $set: expect.objectContaining({
          namespace: 'web',
          operation: 'fetch',
          status: 'ok',
          payload: { value: 1 },
          meta: { provider: 'direct' },
          updatedAt: now,
          expiresAt,
        }),
        $setOnInsert: { createdAt: now },
      }),
      { upsert: true },
    );
  });
});
