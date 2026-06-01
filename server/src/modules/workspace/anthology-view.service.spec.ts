/**
 * AnthologyViewService 单元测试(Phase 1 重构 2026-05-31):
 *
 * Phase 1 后文集 entry CRUD 已并入通用 :scope/items/:id 接口,本 service 只承担视图组装。
 * 测试聚焦剩下的关键方法:
 * - publishAnthology:直接调 contentService.publishVersion,无额外前置校验。
 * - publishAnthologyAndDescendants:先发容器再并发发子节点(若有 latestVersion)。
 * - buildCollectionContextForEntry:给 Aurora 拼整集脉络的纯组装逻辑。
 */
import { Types } from 'mongoose';
import { AnthologyViewService } from './anthology-view.service';

const makeService = (
  o: {
    findById?: jest.Mock;
    publishVersion?: jest.Mock;
    findByContentItemId?: jest.Mock;
    findChildrenByParentId?: jest.Mock;
    findByVersionId?: jest.Mock;
  } = {},
) => {
  const contentRepository = {
    findById: o.findById ?? jest.fn(),
  };
  const contentService = {
    publishVersion: o.publishVersion ?? jest.fn(),
    getLatestSnapshot: jest.fn(),
  };
  const snapshotRepository = {
    findByVersionId: o.findByVersionId ?? jest.fn().mockResolvedValue(null),
  };
  const editorDraftRepository = {};
  const navigationRepository = {
    findByContentItemId:
      o.findByContentItemId ??
      jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    findChildrenByParentId:
      o.findChildrenByParentId ?? jest.fn().mockResolvedValue([]),
  };
  return new AnthologyViewService(
    contentRepository as never,
    contentService as never,
    snapshotRepository as never,
    editorDraftRepository as never,
    navigationRepository as never,
  );
};

describe('AnthologyViewService.publishAnthology', () => {
  it('直接调 contentService.publishVersion(无额外前置校验)', async () => {
    const publishVersion = jest.fn().mockResolvedValue(undefined);
    const svc = makeService({ publishVersion });
    await expect(svc.publishAnthology('ci_x')).resolves.toBeUndefined();
    expect(publishVersion).toHaveBeenCalledWith('ci_x');
  });
});

describe('AnthologyViewService.publishAnthologyAndDescendants', () => {
  it('先发容器,再 Promise.all 发所有有内容的子节点', async () => {
    const publishVersion = jest.fn().mockResolvedValue(undefined);
    const findById = jest.fn().mockImplementation((id: string) => {
      // 容器
      if (id === 'ci_anth') {
        return Promise.resolve({ latestVersion: { versionId: 'v1' } });
      }
      // 子节点 A 有正文,B 无正文
      if (id === 'ci_a') {
        return Promise.resolve({ latestVersion: { versionId: 'va' } });
      }
      if (id === 'ci_b') {
        return Promise.resolve({}); // 无 latestVersion → 跳过
      }
      return Promise.resolve(null);
    });
    const findByContentItemId = jest.fn().mockImplementation((id: string) => {
      if (id === 'ci_anth') {
        return Promise.resolve({ _id: new Types.ObjectId() });
      }
      return Promise.resolve(null);
    });
    const findChildrenByParentId = jest
      .fn()
      .mockResolvedValue([
        { contentItemId: 'ci_a' },
        { contentItemId: 'ci_b' },
      ]);
    const svc = makeService({
      publishVersion,
      findById,
      findByContentItemId,
      findChildrenByParentId,
    });

    await svc.publishAnthologyAndDescendants('ci_anth');

    // 容器先发 + 子节点 A 发,子节点 B 跳过(无 latestVersion)
    expect(publishVersion).toHaveBeenCalledWith('ci_anth');
    expect(publishVersion).toHaveBeenCalledWith('ci_a');
    expect(publishVersion).not.toHaveBeenCalledWith('ci_b');
  });
});

describe('AnthologyViewService.buildCollectionContextForEntry (#150 续 2026-05-31)', () => {
  it('contentItemId 无 `:`(笔记/非文集条目)→ 返 null,不查 anthology', async () => {
    const svc = makeService();
    expect(await svc.buildCollectionContextForEntry('ci_note_xxx')).toBeNull();
  });

  it('文集条目命中:返回标题/共 N 篇/条目列表 + 标当前位置', async () => {
    const anthologyObjId = new Types.ObjectId();
    const findByContentItemId = jest.fn().mockImplementation((id: string) => {
      if (id === 'ci_anth') return Promise.resolve({ _id: anthologyObjId });
      return Promise.resolve(null);
    });
    const findChildrenByParentId = jest.fn().mockResolvedValue([
      { contentItemId: 'entry-a', name: '初到' },
      { contentItemId: 'entry-b', name: '夜走玄武湖' },
      { contentItemId: 'entry-c', name: '回望' },
    ]);
    const findById = jest.fn().mockImplementation((id: string) => {
      if (id === 'ci_anth') {
        return Promise.resolve({ latestVersion: { versionId: 'vidx' } });
      }
      return Promise.resolve({
        latestVersion: {
          title:
            id === 'entry-a'
              ? '初到'
              : id === 'entry-b'
                ? '夜走玄武湖'
                : '回望',
        },
      });
    });
    // 容器 main.md snapshot
    const findByVersionId = jest.fn().mockResolvedValue({
      bodyMarkdown:
        '---\ntitle: "行走南京"\ndescription: "记我在南京的一年"\n---\n',
      createdAt: new Date(),
    });
    const svc = makeService({
      findByContentItemId,
      findChildrenByParentId,
      findById,
      findByVersionId,
    });
    // 子节点 latest snapshot 返回 null 即可,parseEntryContent 容错
    (
      svc as unknown as { contentService: { getLatestSnapshot: jest.Mock } }
    ).contentService.getLatestSnapshot = jest.fn().mockResolvedValue(null);

    const out = await svc.buildCollectionContextForEntry('ci_anth:entry-b');
    expect(out).not.toBeNull();
    expect(out).toContain('本条目属于文集《行走南京》');
    expect(out).toContain('共 3 篇');
    expect(out).toContain('集简介:记我在南京的一年');
    // 当前条目带标记,其他条目不带
    expect(out).toMatch(/夜走玄武湖.*← 当前正在编辑/);
    expect(out).not.toMatch(/初到.*← 当前正在编辑/);
    // 节点 id 必须暴露(给 read_collection_entry 用)
    expect(out).toContain('nodeId: entry-a');
    expect(out).toContain('nodeId: entry-b');
  });

  it('容器找不到 → 返 null 不阻塞 chat', async () => {
    const findByContentItemId = jest.fn().mockResolvedValue(null);
    const svc = makeService({ findByContentItemId });
    expect(
      await svc.buildCollectionContextForEntry('ci_anth:entry-x'),
    ).toBeNull();
  });
});
