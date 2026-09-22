import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LearningProjectService } from '../learning-project.service';
import { LearningProjectRepository } from '../learning-project.repository';
import { NavigationRepository } from '../../navigation/navigation.repository';
import { NavigationNodeService } from '../../navigation/navigation.service';
import { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import type { StructureNodeDto } from '../../navigation/dto/structure-node.dto';
import { NavigationTopologyLockService } from '../../navigation/navigation-topology-lock.service';

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
  let topologyLock: jest.Mocked<NavigationTopologyLockService>;

  beforeEach(() => {
    projectRepo = {
      createActive: jest.fn(),
      findActiveByRootNodeIds: jest.fn(),
      findById: jest.fn(),
      archive: jest.fn(),
    } as unknown as jest.Mocked<LearningProjectRepository>;

    navigationRepo = {
      findAllDescendants: jest.fn(),
      findAllDescendantIds: jest.fn(),
    } as unknown as jest.Mocked<NavigationRepository>;

    navigationService = {
      findStructurePathByNodeId: jest.fn(),
    } as unknown as jest.Mocked<NavigationNodeService>;

    editorDraftRepo = {
      deleteAiDraftsByContentItemIds: jest.fn(),
    } as unknown as jest.Mocked<EditorDraftRepository>;

    topologyLock = {
      runExclusive: jest.fn((operation: () => Promise<unknown>) => operation()),
    } as unknown as jest.Mocked<NavigationTopologyLockService>;

    service = new LearningProjectService(
      projectRepo,
      navigationRepo,
      navigationService,
      editorDraftRepo,
      topologyLock,
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
    navigationRepo.findAllDescendantIds.mockResolvedValue([]);

    const result = await service.resolveByNodeId('child');

    expect(result.project).toBeNull();
    expect(result.canStart).toBe(true);
    expect(result.startBlockedReason).toBeNull();
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
    expect(result.startBlockedReason).toBeNull();
    expect(navigationRepo.findAllDescendantIds).not.toHaveBeenCalled();
  });

  it('resolveByNodeId blocks starting from a parent with an active descendant project', async () => {
    const root = node({ id: 'root', contentItemId: 'ci_root' });
    navigationService.findStructurePathByNodeId.mockResolvedValue([root]);
    navigationRepo.findAllDescendantIds.mockResolvedValue(['child']);
    projectRepo.findActiveByRootNodeIds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'p_child',
          rootNodeId: 'child',
          rootContentItemId: 'ci_child',
          status: 'active',
        },
      ] as never);

    const result = await service.resolveByNodeId('root');

    expect(result.project).toBeNull();
    expect(result.canStart).toBe(false);
    expect(result.startBlockedReason).toBe('descendant-project');
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

  it('startProject checks ancestors and descendants while keeping sibling projects independent', async () => {
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
    });
  });

  it('startProject serializes topology validation and project creation', async () => {
    const root = node({ id: 'root', contentItemId: 'ci_root' });
    navigationService.findStructurePathByNodeId.mockResolvedValue([root]);
    navigationRepo.findAllDescendants.mockResolvedValue([]);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([]);
    projectRepo.createActive.mockResolvedValue({
      id: 'p1',
      rootNodeId: 'root',
      rootContentItemId: 'ci_root',
      status: 'active',
    });

    await service.startProject('root');

    expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
    expect(projectRepo.createActive).toHaveBeenCalledTimes(1);
  });

  it('assertMoveAllowed permits moving ordinary nodes between projects', async () => {
    navigationRepo.findAllDescendantIds.mockResolvedValue(['child']);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([]);

    await expect(
      service.assertMoveAllowed('node', 'target'),
    ).resolves.toBeUndefined();

    expect(navigationService.findStructurePathByNodeId).not.toHaveBeenCalled();
  });

  it('assertMoveAllowed rejects nesting an active project under another one', async () => {
    const target = node({ id: 'target', contentItemId: 'ci_target' });
    navigationRepo.findAllDescendantIds.mockResolvedValue(['project-root']);
    projectRepo.findActiveByRootNodeIds
      .mockResolvedValueOnce([
        {
          id: 'moving-project',
          rootNodeId: 'project-root',
          rootContentItemId: 'ci_moving',
          status: 'active',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'target-project',
          rootNodeId: 'target',
          rootContentItemId: 'ci_target',
          status: 'active',
        },
      ]);
    navigationService.findStructurePathByNodeId.mockResolvedValue([target]);

    await expect(service.assertMoveAllowed('node', 'target')).rejects.toThrow(
      '两个进行中的学习项目范围重叠',
    );
  });

  it('assertMoveAllowed leaves structural cycle detection to navigation', async () => {
    const target = node({ id: 'target', contentItemId: 'ci_target' });
    const project = {
      id: 'same-project',
      rootNodeId: 'project-root',
      rootContentItemId: 'ci_project',
      status: 'active' as const,
    };
    navigationRepo.findAllDescendantIds.mockResolvedValue(['project-root']);
    projectRepo.findActiveByRootNodeIds
      .mockResolvedValueOnce([project])
      .mockResolvedValueOnce([project]);
    navigationService.findStructurePathByNodeId.mockResolvedValue([target]);

    await expect(
      service.assertMoveAllowed('node', 'target'),
    ).resolves.toBeUndefined();
  });

  it('assertDeleteAllowed rejects deleting a subtree with an active project', async () => {
    navigationRepo.findAllDescendantIds.mockResolvedValue(['project-root']);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([
      {
        id: 'p1',
        rootNodeId: 'project-root',
        rootContentItemId: 'ci_root',
        status: 'active',
      },
    ]);

    await expect(service.assertDeleteAllowed('node')).rejects.toThrow(
      '存在进行中的学习',
    );
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
    expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
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
