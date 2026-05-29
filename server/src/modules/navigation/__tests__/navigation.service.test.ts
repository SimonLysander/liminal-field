import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ContentService } from '../../content/content.service';
import { ContentVisibility } from '../../content/dto/content-query.dto';
import { NavigationRepository } from '../navigation.repository';
import { NavigationNodeService } from '../navigation.service';

// 节点同质化(2026-05-29):无 nodeType,每个节点都挂 contentItemId,"容器" 由是否有子节点判定。
function createNode(input: {
  id?: string;
  name: string;
  parentId?: string;
  contentItemId?: string;
  order?: number;
}) {
  return {
    _id: new Types.ObjectId(input.id),
    name: input.name,
    parentId: input.parentId ? new Types.ObjectId(input.parentId) : undefined,
    contentItemId: input.contentItemId,
    order: input.order ?? 0,
    createdAt: new Date('2026-04-17T08:00:00.000Z'),
    updatedAt: null,
  };
}

describe('NavigationNodeService', () => {
  let service: NavigationNodeService;
  let navigationRepository: jest.Mocked<NavigationRepository>;
  let contentService: jest.Mocked<ContentService>;

  beforeEach(() => {
    navigationRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      listByParentId: jest.fn().mockResolvedValue([]),
      findRootNodes: jest.fn(),
      findChildrenByParentId: jest.fn(),
      countChildrenByParentIds: jest.fn().mockResolvedValue({}),
      hasChildren: jest.fn(),
      findByContentItemId: jest.fn(),
      findDuplicateName: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      deleteById: jest.fn(),
      findAllDescendants: jest.fn(),
      deleteManyByIds: jest.fn(),
    } as unknown as jest.Mocked<NavigationRepository>;

    contentService = {
      assertContentItemExists: jest.fn(),
      isContentItemReadable: jest.fn(),
    } as unknown as jest.Mocked<ContentService>;

    service = new NavigationNodeService(navigationRepository, contentService);
  });

  it('创建节点:校验内容项存在后写入(不带 nodeType)', async () => {
    const contentItemId = new Types.ObjectId().toString();
    const created = createNode({
      name: 'React Hooks Intro',
      contentItemId,
      order: 2,
    });
    navigationRepository.create.mockResolvedValue(created as never);

    const result = await service.createNavigationNode({
      name: 'React Hooks Intro',
      contentItemId,
      order: 2,
    });

    expect(contentService.assertContentItemExists.mock.calls).toEqual([
      [contentItemId],
    ]);
    expect(navigationRepository.create.mock.calls).toEqual([
      [{ name: 'React Hooks Intro', contentItemId, order: 2 }],
    ]);
    expect(result).toMatchObject({
      id: created._id.toString(),
      name: 'React Hooks Intro',
      contentItemId,
      hasChildren: false,
    });
  });

  it('拒绝没有 contentItemId 的节点', async () => {
    await expect(
      service.createNavigationNode({
        name: 'Invalid node',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('级联删除节点及其全部后代', async () => {
    const parent = createNode({ name: 'Frontend', contentItemId: 'ci_parent' });
    const child = createNode({
      name: 'React Guide',
      contentItemId: 'ci_child',
      parentId: parent._id.toString(),
    });
    navigationRepository.findById.mockResolvedValue(parent as never);
    navigationRepository.findAllDescendants.mockResolvedValue([child] as never);
    navigationRepository.deleteManyByIds.mockResolvedValue(undefined);
    // 未发布 → 允许删
    (
      contentService as unknown as { getContentListItem: jest.Mock }
    ).getContentListItem = jest
      .fn()
      .mockResolvedValue({ publishedVersion: null, title: 'x' });

    await service.deleteNavigationNodeById(parent._id.toString());

    expect(navigationRepository.deleteManyByIds).toHaveBeenCalledWith([
      parent._id.toString(),
      child._id.toString(),
    ]);
  });

  it('构建从根到目标节点的路径', async () => {
    const root = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Frontend',
      contentItemId: 'ci_root',
    });
    const child = createNode({
      id: new Types.ObjectId().toString(),
      name: 'React Hooks Intro',
      parentId: root._id.toString(),
      contentItemId: new Types.ObjectId().toString(),
    });

    navigationRepository.findById.mockImplementation((id: string) => {
      if (id === child._id.toString()) return Promise.resolve(child as never);
      if (id === root._id.toString()) return Promise.resolve(root as never);
      return Promise.resolve(null);
    });

    const result = await service.findPathByNodeId(child._id.toString());

    expect(result.map((node) => node.id)).toEqual([
      root._id.toString(),
      child._id.toString(),
    ]);
  });

  it('结构列表:有子节点→FOLDER,叶子→DOC', async () => {
    const folder = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Frontend',
      contentItemId: 'ci_folder',
      order: 1,
    });
    const doc = createNode({
      id: new Types.ObjectId().toString(),
      name: 'React Hooks Intro',
      contentItemId: new Types.ObjectId().toString(),
      order: 2,
    });

    navigationRepository.listByParentId.mockResolvedValue([
      folder,
      doc,
    ] as never);
    navigationRepository.countChildrenByParentIds.mockResolvedValue({
      [folder._id.toString()]: 1,
    });
    contentService.isContentItemReadable.mockResolvedValue(true);

    const result = await service.listStructureNodes();

    expect(result.path).toEqual([]);
    expect(result.children).toEqual([
      expect.objectContaining({
        id: folder._id.toString(),
        type: 'FOLDER',
        sortOrder: 1,
        hasChildren: true,
      }),
      expect.objectContaining({
        id: doc._id.toString(),
        type: 'DOC',
        contentItemId: doc.contentItemId,
        sortOrder: 2,
        hasChildren: false,
      }),
    ]);
  });

  it('公开列表隐藏不可读的叶子节点', async () => {
    const docA = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Published',
      contentItemId: 'ci_pub',
    });
    const docB = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Draft',
      contentItemId: 'ci_draft',
    });

    navigationRepository.listByParentId.mockImplementation(
      (parentId?: string) =>
        Promise.resolve((parentId ? [] : [docA, docB]) as never),
    );
    contentService.isContentItemReadable.mockImplementation((ci: string) =>
      Promise.resolve(ci === 'ci_pub'),
    );

    const result = await service.listStructureNodes();

    expect(result.children).toEqual([
      expect.objectContaining({ id: docA._id.toString(), type: 'DOC' }),
    ]);
  });

  it('管理端(visibility=all)保留全部节点', async () => {
    const draftDoc = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Draft doc',
      contentItemId: 'ci_draft_doc',
    });

    navigationRepository.listByParentId.mockResolvedValue([draftDoc] as never);

    const result = await service.listStructureNodes(
      undefined,
      ContentVisibility.all,
    );

    expect(result.children).toEqual([
      expect.objectContaining({
        id: draftDoc._id.toString(),
        type: 'DOC',
        contentItemId: 'ci_draft_doc',
      }),
    ]);
    expect(contentService.isContentItemReadable.mock.calls).toEqual([]);
  });

  it('更新不存在的节点抛 NotFound', async () => {
    navigationRepository.findById.mockResolvedValue(null);

    await expect(
      service.updateNavigationNode('missing', { name: 'Updated' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
