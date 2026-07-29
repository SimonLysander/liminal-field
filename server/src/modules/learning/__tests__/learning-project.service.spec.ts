import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LearningProjectService } from '../learning-project.service';
import { LearningProjectRepository } from '../learning-project.repository';
import { NavigationRepository } from '../../navigation/navigation.repository';
import { NavigationNodeService } from '../../navigation/navigation.service';
import { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import type { StructureNodeDto } from '../../navigation/dto/structure-node.dto';

function node(input: {
  id: string;
  name?: string;
  parentId?: string;
  contentItemId: string;
}): StructureNodeDto {
  return {
    id: input.id,
    name: input.name ?? input.id,
    type: 'DOC',
    scope: 'notes',
    parentId: input.parentId,
    contentItemId: input.contentItemId,
    sortOrder: 0,
    hasChildren: false,
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    updatedAt: undefined,
  };
}

describe('LearningProjectService', () => {
  let service: LearningProjectService;
  let projectRepo: jest.Mocked<LearningProjectRepository>;
  let navigationRepo: jest.Mocked<NavigationRepository>;
  let navigationService: jest.Mocked<NavigationNodeService>;
  let editorDraftRepo: jest.Mocked<EditorDraftRepository>;

  beforeEach(() => {
    projectRepo = {
      createActive: jest.fn(),
      findActiveByRootNodeIds: jest.fn(),
      findById: jest.fn(),
      archive: jest.fn(),
    } as unknown as jest.Mocked<LearningProjectRepository>;

    navigationRepo = {
      findAllDescendants: jest.fn(),
    } as unknown as jest.Mocked<NavigationRepository>;

    navigationService = {
      findStructurePathByNodeId: jest.fn(),
    } as unknown as jest.Mocked<NavigationNodeService>;

    editorDraftRepo = {
      deleteAiDraftsByContentItemIds: jest.fn(),
    } as unknown as jest.Mocked<EditorDraftRepository>;

    service = new LearningProjectService(
      projectRepo,
      navigationRepo,
      navigationService,
      editorDraftRepo,
    );
  });

  it('resolveByNodeId returns startable state when no ancestor has an active project', async () => {
    const root = node({ id: 'root', contentItemId: 'ci_root' });
    const child = node({
      id: 'child',
      parentId: 'root',
      contentItemId: 'ci_child',
    });
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      root,
      child,
    ]);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([]);

    const result = await service.resolveByNodeId('child');

    expect(result.project).toBeNull();
    expect(result.canStart).toBe(true);
    expect(result.currentNode.id).toBe('child');
    expect(result.rootNode.id).toBe('child');
  });

  it('resolveByNodeId picks the nearest active ancestor project', async () => {
    const root = node({ id: 'root', contentItemId: 'ci_root' });
    const mid = node({ id: 'mid', parentId: 'root', contentItemId: 'ci_mid' });
    const leaf = node({
      id: 'leaf',
      parentId: 'mid',
      contentItemId: 'ci_leaf',
    });
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      root,
      mid,
      leaf,
    ]);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([
      {
        id: 'p_root',
        rootNodeId: 'root',
        rootContentItemId: 'ci_root',
        status: 'active',
      },
      {
        id: 'p_mid',
        rootNodeId: 'mid',
        rootContentItemId: 'ci_mid',
        status: 'active',
      },
    ] as never);

    const result = await service.resolveByNodeId('leaf');

    expect(result.project?.id).toBe('p_mid');
    expect(result.rootNode.id).toBe('mid');
    expect(result.canStart).toBe(false);
  });

  it('startProject rejects roots that overlap an existing active project', async () => {
    const root = node({ id: 'root', contentItemId: 'ci_root' });
    navigationService.findStructurePathByNodeId.mockResolvedValue([root]);
    navigationRepo.findAllDescendants.mockResolvedValue([
      { _id: { toString: () => 'child' }, contentItemId: 'ci_child' },
    ] as never);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([
      {
        id: 'p_child',
        rootNodeId: 'child',
        rootContentItemId: 'ci_child',
        status: 'active',
      },
    ] as never);

    await expect(service.startProject('root')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(projectRepo.createActive).not.toHaveBeenCalled();
  });

  it('startProject maps duplicate active-root insert races to a business error', async () => {
    const root = node({ id: 'root', contentItemId: 'ci_root' });
    navigationService.findStructurePathByNodeId.mockResolvedValue([root]);
    navigationRepo.findAllDescendants.mockResolvedValue([]);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([]);
    projectRepo.createActive.mockRejectedValue({ code: 11000 });

    await expect(service.startProject('root')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('startProject checks ancestors but persists only the subtree so sibling projects remain independent', async () => {
    const parent = node({ id: 'parent', contentItemId: 'ci_parent' });
    const root = node({
      id: 'root',
      parentId: 'parent',
      contentItemId: 'ci_root',
    });
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      parent,
      root,
    ]);
    navigationRepo.findAllDescendants.mockResolvedValue([
      { _id: { toString: () => 'child' }, contentItemId: 'ci_child' },
      { _id: { toString: () => 'leaf' }, contentItemId: 'ci_leaf' },
    ] as never);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([]);
    projectRepo.createActive.mockResolvedValue({
      id: 'p1',
      rootNodeId: 'root',
      rootContentItemId: 'ci_root',
      status: 'active',
    });

    await service.startProject('root');

    expect(projectRepo.findActiveByRootNodeIds).toHaveBeenCalledWith([
      'parent',
      'root',
      'child',
      'leaf',
    ]);
    expect(projectRepo.createActive).toHaveBeenCalledWith({
      rootNodeId: 'root',
      rootContentItemId: 'ci_root',
      scopeNodeIds: ['root', 'child', 'leaf'],
    });
  });

  it('discardProject deletes root and descendant aidrafts then archives the project', async () => {
    projectRepo.findById.mockResolvedValue({
      id: 'p1',
      rootNodeId: 'root',
      rootContentItemId: 'ci_root',
      status: 'active',
    } as never);
    navigationRepo.findAllDescendants.mockResolvedValue([
      { _id: { toString: () => 'child' }, contentItemId: 'ci_child' },
      { _id: { toString: () => 'leaf' }, contentItemId: 'ci_leaf' },
    ] as never);
    editorDraftRepo.deleteAiDraftsByContentItemIds.mockResolvedValue(3);
    projectRepo.archive.mockResolvedValue({
      id: 'p1',
      rootNodeId: 'root',
      rootContentItemId: 'ci_root',
      status: 'archived',
    } as never);

    const result = await service.discardProject('p1');

    expect(editorDraftRepo.deleteAiDraftsByContentItemIds).toHaveBeenCalledWith(
      ['ci_root', 'ci_child', 'ci_leaf'],
    );
    expect(projectRepo.archive).toHaveBeenCalledWith('p1');
    expect(result).toEqual({
      affectedContentItemIds: ['ci_root', 'ci_child', 'ci_leaf'],
      deleted: 3,
    });
  });

  it('discardProject is idempotent for archived projects', async () => {
    projectRepo.findById.mockResolvedValue({
      id: 'p1',
      rootNodeId: 'root',
      rootContentItemId: 'ci_root',
      status: 'archived',
    } as never);

    const result = await service.discardProject('p1');

    expect(result).toEqual({ affectedContentItemIds: [], deleted: 0 });
    expect(
      editorDraftRepo.deleteAiDraftsByContentItemIds,
    ).not.toHaveBeenCalled();
  });

  it('discardProject rejects missing projects', async () => {
    projectRepo.findById.mockResolvedValue(null);

    await expect(service.discardProject('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
