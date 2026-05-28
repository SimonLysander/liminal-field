/**
 * AnthologyViewService 发布顺序契约(2026-05-28 改为「文集先发」):
 * - publishEntry:文集未发布(publishedVersion 为空)时拒绝,提示先发布文集。
 * - publishEntry:文集已发布时放行(不被发布顺序守卫拦)。
 * - publishAnthology:不再要求"至少一篇已发布条目",直接调 publishVersion。
 *
 * 只测两处守卫,故用最小 mock 构造 service(守卫只触达 contentRepository.findById /
 * contentService.publishVersion;snapshotRepository.findLatestByFileName 给 null 让 loadIndex 走空)。
 */
import { AnthologyViewService } from './anthology-view.service';

const makeService = (
  o: {
    findById?: jest.Mock;
    publishVersion?: jest.Mock;
    findLatest?: jest.Mock;
  } = {},
) => {
  const contentRepository = {
    findById: o.findById ?? jest.fn(),
    setEntryPublishStates: jest.fn(),
  };
  const contentService = { publishVersion: o.publishVersion ?? jest.fn() };
  const snapshotRepository = {
    findLatestByFileName: o.findLatest ?? jest.fn().mockResolvedValue(null),
  };
  const editorDraftRepository = {};
  return new AnthologyViewService(
    contentRepository as never,
    contentService as never,
    snapshotRepository as never,
    editorDraftRepository as never,
  );
};

describe('AnthologyViewService 发布顺序(文集先发)', () => {
  it('publishEntry:文集未发布 → 拒绝并提示先发布文集', async () => {
    const svc = makeService({
      findById: jest.fn().mockResolvedValue({ publishedVersion: null }),
    });
    await expect(svc.publishEntry('ci_x', 'e_1')).rejects.toThrow(
      '请先发布文集',
    );
  });

  it('publishEntry:文集已发布 → 放行(不被发布顺序守卫拦)', async () => {
    const svc = makeService({
      findById: jest
        .fn()
        .mockResolvedValue({ publishedVersion: { versionId: 'v1' } }),
      // loadIndex 拿不到 snapshot → 空索引 → 条目不存在,会抛"not found"(而非"请先发布文集")
    });
    await expect(svc.publishEntry('ci_x', 'e_1')).rejects.not.toThrow(
      '请先发布文集',
    );
  });

  it('publishAnthology:不再要求已发布条目,直接 publishVersion', async () => {
    const publishVersion = jest.fn().mockResolvedValue(undefined);
    const svc = makeService({ publishVersion });
    await expect(svc.publishAnthology('ci_x')).resolves.toBeUndefined();
    expect(publishVersion).toHaveBeenCalledWith('ci_x');
  });
});
