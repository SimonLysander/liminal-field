/**
 * AnthologyViewService 发布顺序契约(2026-05-28 起「文集先发」,Phase 2 改子节点模型后不变):
 * - publishEntry:文集未发布(容器 publishedVersion 为空)时拒绝,提示先发布文集。
 * - publishEntry:文集已发布时放行(不被发布顺序守卫拦,后续因条目不存在抛 not found)。
 * - publishAnthology:直接调 contentService.publishVersion,无额外前置校验。
 *
 * 只测发布顺序两处守卫,用最小 mock 构造 service。Phase 2 后:
 * - publishEntry 先 contentRepository.findById(容器) 判 publishedVersion;
 * - 再 navigationRepository.findByContentItemId(容器) 取文集节点(给个带 _id 的桩),
 *   然后 getEntryNode 查不到条目 → 抛 "not found"(而非"请先发布文集")。
 */
import { Types } from 'mongoose';
import { AnthologyViewService } from './anthology-view.service';

const makeService = (
  o: {
    findById?: jest.Mock;
    publishVersion?: jest.Mock;
    findByContentItemId?: jest.Mock;
  } = {},
) => {
  const contentRepository = {
    findById: o.findById ?? jest.fn(),
  };
  const contentService = { publishVersion: o.publishVersion ?? jest.fn() };
  const snapshotRepository = {};
  const editorDraftRepository = {};
  const navigationRepository = {
    // 文集节点桩:带 _id,让 getEntryNode 能继续往下走(再因条目查不到抛 404)
    findByContentItemId:
      o.findByContentItemId ??
      jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
  };
  return new AnthologyViewService(
    contentRepository as never,
    contentService as never,
    snapshotRepository as never,
    editorDraftRepository as never,
    navigationRepository as never,
  );
};

describe('AnthologyViewService 发布顺序(文集先发)', () => {
  it('publishEntry:文集未发布 → 拒绝并提示先发布文集', async () => {
    const svc = makeService({
      findById: jest.fn().mockResolvedValue({ publishedVersion: null }),
    });
    await expect(svc.publishEntry('ci_x', 'ci_entry')).rejects.toThrow(
      '请先发布文集',
    );
  });

  it('publishEntry:文集已发布 → 放行(不被发布顺序守卫拦)', async () => {
    const svc = makeService({
      findById: jest
        .fn()
        .mockResolvedValue({ publishedVersion: { versionId: 'v1' } }),
      // getEntryNode 查不到子条目节点 → 抛 "not found"(而非"请先发布文集")
      findByContentItemId: jest
        .fn()
        // 第一次调用(getAnthologyNode)给容器节点桩
        .mockResolvedValueOnce({ _id: new Types.ObjectId() })
        // 第二次调用(getEntryNode 查条目)给 null → 抛 not found
        .mockResolvedValueOnce(null),
    });
    await expect(svc.publishEntry('ci_x', 'ci_entry')).rejects.not.toThrow(
      '请先发布文集',
    );
  });

  it('publishAnthology:直接 publishVersion(无额外前置校验)', async () => {
    const publishVersion = jest.fn().mockResolvedValue(undefined);
    const svc = makeService({ publishVersion });
    await expect(svc.publishAnthology('ci_x')).resolves.toBeUndefined();
    expect(publishVersion).toHaveBeenCalledWith('ci_x');
  });
});
