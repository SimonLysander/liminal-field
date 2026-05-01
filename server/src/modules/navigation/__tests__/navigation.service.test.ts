import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ContentService } from '../../content/content.service';
import { ContentVisibility } from '../../content/dto/content-query.dto';
import { NavigationRepository } from '../navigation.repository';
import { NavigationNodeType } from '../navigation.entity';
import { NavigationNodeService } from '../navigation.service';

function createNode(input: {
  id?: string;
  name: string;
  nodeType: NavigationNodeType;
  parentId?: string;
  contentItemId?: string;
  order?: number;
}) {
  return {
    _id: new Types.ObjectId(input.id),
    name: input.name,
    nodeType: input.nodeType,
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
      listByParentId: jest.fn(),
      findRootNodes: jest.fn(),
      findChildrenByParentId: jest.fn(),
      countChildrenByParentIds: jest.fn(),
      hasChildren: jest.fn(),
      findByContentItemId: jest.fn(),
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

  it('creates a content navigation node after validating its content item', async () => {
    const created = createNode({
      name: 'React Hooks Intro',
      nodeType: NavigationNodeType.content,
      contentItemId: new Types.ObjectId().toString(),
      order: 2,
    });
    navigationRepository.create.mockResolvedValue(created as never);

    const result = await service.createNavigationNode({
      name: 'React Hooks Intro',
      nodeType: NavigationNodeType.content,
      contentItemId: created.contentItemId!.toString(),
      order: 2,
    });

    expect(contentService.assertContentItemExists.mock.calls).toEqual([
      [created.contentItemId!.toString()],
    ]);
    expect(navigationRepository.create.mock.calls).toEqual([
      [
        {
          name: 'React Hooks Intro',
          nodeType: NavigationNodeType.content,
          contentItemId: created.contentItemId!.toString(),
          order: 2,
        },
      ],
    ]);
    expect(result).toMatchObject({
      id: created._id.toString(),
      name: 'React Hooks Intro',
      nodeType: NavigationNodeType.content,
      contentItemId: created.contentItemId!.toString(),
      hasChildren: false,
    });
  });

  it('rejects content nodes without contentItemId', async () => {
    await expect(
      service.createNavigationNode({
        name: 'Invalid content node',
        nodeType: NavigationNodeType.content,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cascade deletes a node and all its descendants', async () => {
    const parent = createNode({
      name: 'Frontend',
      nodeType: NavigationNodeType.subject,
    });
    const child = createNode({
      name: 'React Guide',
      nodeType: NavigationNodeType.content,
      parentId: parent._id,
    });
    navigationRepository.findById.mockResolvedValue(parent as never);
    navigationRepository.findAllDescendants.mockResolvedValue([child] as never);
    navigationRepository.deleteManyByIds.mockResolvedValue(undefined);

    await service.deleteNavigationNodeById(parent._id.toString());

    expect(navigationRepository.deleteManyByIds).toHaveBeenCalledWith([
      parent._id.toString(),
      child._id.toString(),
    ]);
  });

  it('builds a path from root to target node', async () => {
    const root = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Frontend',
      nodeType: NavigationNodeType.subject,
    });
    const child = createNode({
      id: new Types.ObjectId().toString(),
      name: 'React Hooks Intro',
      nodeType: NavigationNodeType.content,
      parentId: root._id.toString(),
      contentItemId: new Types.ObjectId().toString(),
    });

    navigationRepository.findById.mockImplementation((id: string) => {
      if (id === child._id.toString()) {
        return Promise.resolve(child as never);
      }
      if (id === root._id.toString()) {
        return Promise.resolve(root as never);
      }
      return Promise.resolve(null);
    });
    navigationRepository.countChildrenByParentIds.mockResolvedValue({});

    const result = await service.findPathByNodeId(child._id.toString());

    expect(result.map((node) => node.id)).toEqual([
      root._id.toString(),
      child._id.toString(),
    ]);
  });

  it('maps structure nodes to FOLDER and DOC output types', async () => {
    const folder = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Frontend',
      nodeType: NavigationNodeType.subject,
      order: 1,
    });
    const doc = createNode({
      id: new Types.ObjectId().toString(),
      name: 'React Hooks Intro',
      nodeType: NavigationNodeType.content,
      parentId: folder._id.toString(),
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

  it('hides unreadable doc nodes from public structure listings', async () => {
    const folder = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Frontend',
      nodeType: NavigationNodeType.subject,
    });
    const draftDoc = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Draft doc',
      nodeType: NavigationNodeType.content,
      parentId: folder._id.toString(),
      contentItemId: 'ci_draft_doc',
    });

    navigationRepository.listByParentId.mockResolvedValue([
      folder,
      draftDoc,
    ] as never);
    navigationRepository.countChildrenByParentIds.mockResolvedValue({});
    contentService.isContentItemReadable.mockResolvedValue(false);

    const result = await service.listStructureNodes();

    expect(result.children).toEqual([
      expect.objectContaining({
        id: folder._id.toString(),
        type: 'FOLDER',
      }),
    ]);
    expect(contentService.isContentItemReadable.mock.calls).toEqual([
      ['ci_draft_doc', undefined],
    ]);
  });

  it('keeps doc nodes visible for admin structure listings', async () => {
    const draftDoc = createNode({
      id: new Types.ObjectId().toString(),
      name: 'Draft doc',
      nodeType: NavigationNodeType.content,
      contentItemId: 'ci_draft_doc',
    });

    navigationRepository.listByParentId.mockResolvedValue([draftDoc] as never);
    navigationRepository.countChildrenByParentIds.mockResolvedValue({});

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

  it('throws when updating a missing node', async () => {
    navigationRepository.findById.mockResolvedValue(null);

    await expect(
      service.updateNavigationNode('missing', { name: 'Updated' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
