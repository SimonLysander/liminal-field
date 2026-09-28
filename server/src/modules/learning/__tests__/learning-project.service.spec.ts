import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LearningProjectService } from '../learning-project.service';
import { LearningProjectRepository } from '../learning-project.repository';
import { NavigationRepository } from '../../navigation/navigation.repository';
import { NavigationNodeService } from '../../navigation/navigation.service';
import { NavigationTopologyLockService } from '../../navigation/navigation-topology-lock.service';
import { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import type { StructureNodeDto } from '../../navigation/dto/structure-node.dto';
import type { LearningProjectDto } from '../dto/learning-project.dto';

function node(id: string, parentId?: string): StructureNodeDto {
  return {
    id,
    name: id,
    type: 'DOC',
    scope: 'notes',
    parentId,
    contentItemId: `ci_${id}`,
    sortOrder: 0,
    hasChildren: false,
    createdAt: new Date('2026-07-09T00:00:00.000Z'),
    updatedAt: undefined,
  };
}

function project(rootNodeId: string): LearningProjectDto {
  return {
    id: `p_${rootNodeId}`,
    rootNodeId,
    rootContentItemId: `ci_${rootNodeId}`,
    status: 'active',
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
      findActiveByRootNodeIds: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      archive: jest.fn(),
      archiveActiveByIds: jest.fn(),
      restoreActiveByIds: jest.fn(),
    } as unknown as jest.Mocked<LearningProjectRepository>;
    navigationRepo = {
      findAllDescendants: jest.fn().mockResolvedValue([]),
      findAllDescendantIds: jest.fn().mockResolvedValue([]),
      findExistingIds: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<NavigationRepository>;
    navigationService = {
      findStructurePathByNodeId: jest.fn(),
      findStructurePathByContentItemId: jest.fn(),
    } as unknown as jest.Mocked<NavigationNodeService>;
    editorDraftRepo = {
      deleteAiDraftsByContentItemIds: jest.fn().mockResolvedValue(0),
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

  it('allows starting on a parent without inspecting existing descendant projects', async () => {
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node('root'),
    ]);
    const result = await service.resolveByNodeId('root');

    expect(result).toMatchObject({
      project: null,
      canStart: true,
      rootNode: { id: 'root' },
    });
    expect(projectRepo.findActiveByRootNodeIds).toHaveBeenCalledTimes(1);
    expect(projectRepo.findActiveByRootNodeIds).toHaveBeenCalledWith(['root']);
    expect(navigationRepo.findAllDescendantIds).not.toHaveBeenCalled();
  });

  it.each(['mid', 'leaf'])(
    'resolves %s to its nearest independent learning root',
    async (id) => {
      const path = [node('root'), node('mid', 'root'), node('leaf', 'mid')];
      navigationService.findStructurePathByNodeId.mockResolvedValue(
        path.slice(0, id === 'mid' ? 2 : 3),
      );
      projectRepo.findActiveByRootNodeIds.mockResolvedValue([
        project('root'),
        project('mid'),
      ]);

      const result = await service.resolveByNodeId(id);

      expect(result).toMatchObject({
        project: project('mid'),
        canStart: false,
        rootNode: { id: 'mid' },
        currentNode: { id },
      });
    },
  );

  it('does not assign sibling pages to an independent child project', async () => {
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node('root'),
      node('sibling', 'root'),
    ]);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('root')]);
    expect((await service.resolveByNodeId('sibling')).project?.id).toBe(
      'p_root',
    );
    expect(projectRepo.findActiveByRootNodeIds).toHaveBeenCalledWith([
      'root',
      'sibling',
    ]);
  });

  it('creates a project without ancestor or descendant exclusivity', async () => {
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node('parent'),
      node('root', 'parent'),
    ]);
    projectRepo.createActive.mockResolvedValue(project('root'));
    await expect(service.startProject('root')).resolves.toEqual(
      project('root'),
    );

    expect(projectRepo.findActiveByRootNodeIds).toHaveBeenCalledWith(['root']);
    expect(projectRepo.createActive).toHaveBeenCalledWith({
      rootNodeId: 'root',
      rootContentItemId: 'ci_root',
    });
    expect(navigationRepo.findAllDescendants).not.toHaveBeenCalled();
    expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
  });

  it('rejects a second active project on the exact same page', async () => {
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node('root'),
    ]);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('root')]);
    await expect(service.startProject('root')).rejects.toThrow(
      '当前页面已开始学习',
    );
    expect(projectRepo.createActive).not.toHaveBeenCalled();
  });

  it('maps the database unique-root race to the same business error', async () => {
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node('root'),
    ]);
    projectRepo.createActive.mockRejectedValue({ code: 11000 });
    await expect(service.startProject('root')).rejects.toThrow(
      '当前页面已开始学习',
    );
  });

  it.each([
    ['root', 'plan', true],
    ['leaf', 'draft', true],
    ['root', 'draft', false],
    ['leaf', 'plan', false],
  ] as const)(
    'guards the %s page for a %s write',
    async (id, kind, allowed) => {
      const path =
        id === 'root' ? [node('root')] : [node('root'), node('leaf', 'root')];
      navigationService.findStructurePathByContentItemId.mockResolvedValue(
        path,
      );
      navigationService.findStructurePathByNodeId.mockResolvedValue(path);
      projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('root')]);
      const write = jest.fn().mockResolvedValue('saved');

      if (allowed) {
        await expect(service.runWrite(`ci_${id}`, kind, write)).resolves.toBe(
          'saved',
        );
        expect(write).toHaveBeenCalledTimes(1);
      } else {
        await expect(
          service.runWrite(`ci_${id}`, kind, write),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(write).not.toHaveBeenCalled();
      }
      expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a stale writer after its page becomes an independent learning root', async () => {
    const path = [node('root'), node('child', 'root')];
    navigationService.findStructurePathByContentItemId.mockResolvedValue(path);
    navigationService.findStructurePathByNodeId.mockResolvedValue(path);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([
      project('root'),
      project('child'),
    ]);
    const write = jest.fn();
    await expect(service.runWrite('ci_child', 'draft', write)).rejects.toThrow(
      '学习归属已变化',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects writes after the learning project has been discarded', async () => {
    navigationService.findStructurePathByContentItemId.mockResolvedValue([
      node('root'),
    ]);
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node('root'),
    ]);
    const write = jest.fn();
    await expect(service.runWrite('ci_root', 'plan', write)).rejects.toThrow(
      '学习归属已变化',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('ends only the projects rooted in the deletion range before deleting', async () => {
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('child')]);
    const remove = jest.fn(() => {
      expect(projectRepo.archiveActiveByIds).toHaveBeenCalledWith(['p_child']);
      return Promise.resolve();
    });
    await service.runSubtreeDeletion(['child', 'leaf'], remove);
    expect(projectRepo.findActiveByRootNodeIds).toHaveBeenCalledWith([
      'child',
      'leaf',
    ]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(
      editorDraftRepo.deleteAiDraftsByContentItemIds,
    ).not.toHaveBeenCalled();
    expect(projectRepo.restoreActiveByIds).not.toHaveBeenCalled();
  });

  it('restores active learning when deletion fails and the root still exists', async () => {
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('child')]);
    navigationRepo.findExistingIds.mockResolvedValue(['child']);
    await expect(
      service.runSubtreeDeletion(['child'], () =>
        Promise.reject(new Error('delete failed')),
      ),
    ).rejects.toThrow('delete failed');
    expect(projectRepo.restoreActiveByIds).toHaveBeenCalledWith(['p_child']);
  });

  it('does not delete when ending learning fails, and restores partially archived projects', async () => {
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('child')]);
    projectRepo.archiveActiveByIds.mockRejectedValue(
      new Error('archive failed'),
    );
    navigationRepo.findExistingIds.mockResolvedValue(['child']);
    const remove = jest.fn();
    await expect(service.runSubtreeDeletion(['child'], remove)).rejects.toThrow(
      'archive failed',
    );
    expect(remove).not.toHaveBeenCalled();
    expect(projectRepo.restoreActiveByIds).toHaveBeenCalledWith(['p_child']);
  });

  it('does not reactivate deleted roots when the deletion response was lost', async () => {
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([
      project('child'),
      project('remaining'),
    ]);
    navigationRepo.findExistingIds.mockResolvedValue(['remaining']);
    await expect(
      service.runSubtreeDeletion(['child', 'remaining'], () =>
        Promise.reject(new Error('response lost')),
      ),
    ).rejects.toThrow('response lost');
    expect(projectRepo.restoreActiveByIds).toHaveBeenCalledWith([
      'p_remaining',
    ]);
  });

  it('reports both deletion and restoration failures', async () => {
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('child')]);
    navigationRepo.findExistingIds.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      service.runSubtreeDeletion(['child'], () =>
        Promise.reject(new Error('delete failed')),
      ),
    ).rejects.toBeInstanceOf(AggregateError);
  });

  it('returns ordered owned chapters and independent root entries without their descendants', async () => {
    const root = new Types.ObjectId();
    const child = new Types.ObjectId();
    const leaf = new Types.ObjectId();
    const sibling = new Types.ObjectId();
    const nested = new Types.ObjectId();
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node(root.toString()),
    ]);
    projectRepo.findActiveByRootNodeIds
      .mockResolvedValueOnce([project(root.toString())])
      .mockResolvedValueOnce([project(nested.toString())]);
    navigationRepo.findAllDescendants.mockResolvedValue([
      {
        _id: leaf,
        parentId: child,
        name: 'leaf',
        order: 0,
        contentItemId: 'ci_leaf',
      },
      {
        _id: sibling,
        parentId: root,
        name: 'sibling',
        order: 2,
        contentItemId: 'ci_sibling',
      },
      {
        _id: nested,
        parentId: root,
        name: 'nested',
        order: 0,
        contentItemId: 'ci_nested',
      },
      {
        _id: new Types.ObjectId(),
        parentId: nested,
        name: 'excluded',
        order: 0,
      },
      {
        _id: child,
        parentId: root,
        name: 'child',
        order: 1,
        contentItemId: 'ci_child',
      },
    ] as never);
    const outline = await service.getOutline(root.toString());
    expect(
      outline.chapters.map((chapter) => [
        chapter.node.name,
        chapter.depth,
        chapter.isIndependentLearningRoot,
      ]),
    ).toEqual([
      ['nested', 0, true],
      ['child', 0, false],
      ['leaf', 1, false],
      ['sibling', 0, false],
    ]);
    expect(outline.chapters[0].node.hasChildren).toBe(true);
  });

  it('rejects outlines requested from a page that inherits an ancestor project', async () => {
    navigationService.findStructurePathByNodeId.mockResolvedValue([
      node('root'),
      node('leaf', 'root'),
    ]);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([project('root')]);
    await expect(service.getOutline('leaf')).rejects.toThrow('学习归属已变化');
    expect(navigationRepo.findAllDescendants).not.toHaveBeenCalled();
  });

  it('discards only owned pages and protects every nested independent subtree regardless of result order', async () => {
    const root = new Types.ObjectId();
    const child = new Types.ObjectId();
    const middle = new Types.ObjectId();
    const leaf = new Types.ObjectId();
    const sibling = new Types.ObjectId();
    const nested = new Types.ObjectId();
    const nodes = [
      { _id: leaf, parentId: middle, contentItemId: 'ci_leaf' },
      { _id: sibling, parentId: root, contentItemId: 'ci_sibling' },
      { _id: child, parentId: root, contentItemId: 'ci_child' },
      { _id: nested, parentId: root, contentItemId: 'ci_nested' },
      { _id: middle, parentId: child, contentItemId: 'ci_middle' },
    ];
    projectRepo.findById.mockResolvedValue({
      ...project(root.toString()),
      rootContentItemId: 'ci_root',
    });
    navigationRepo.findAllDescendants.mockResolvedValue(nodes as never);
    projectRepo.findActiveByRootNodeIds.mockResolvedValue([
      project(child.toString()),
      project(nested.toString()),
    ]);
    editorDraftRepo.deleteAiDraftsByContentItemIds.mockResolvedValue(2);

    const result = await service.discardProject(`p_${root.toString()}`);

    expect(result).toEqual({
      affectedContentItemIds: ['ci_root', 'ci_sibling'],
      deleted: 2,
    });
    expect(editorDraftRepo.deleteAiDraftsByContentItemIds).toHaveBeenCalledWith(
      ['ci_root', 'ci_sibling'],
    );
    expect(projectRepo.archive).toHaveBeenCalledTimes(1);
    expect(projectRepo.archive).toHaveBeenCalledWith(`p_${root.toString()}`);
    expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
  });

  it('discards the full current subtree if it has no independent child projects', async () => {
    projectRepo.findById.mockResolvedValue(project('root'));
    navigationRepo.findAllDescendants.mockResolvedValue([
      { _id: new Types.ObjectId(), contentItemId: 'ci_leaf' },
    ] as never);
    editorDraftRepo.deleteAiDraftsByContentItemIds.mockResolvedValue(2);
    expect(await service.discardProject('p_root')).toEqual({
      affectedContentItemIds: ['ci_root', 'ci_leaf'],
      deleted: 2,
    });
  });

  it('does not archive a project if draft deletion fails', async () => {
    projectRepo.findById.mockResolvedValue(project('root'));
    editorDraftRepo.deleteAiDraftsByContentItemIds.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(service.discardProject('p_root')).rejects.toThrow(
      'database unavailable',
    );
    expect(projectRepo.archive).not.toHaveBeenCalled();
  });

  it('is idempotent for archived projects', async () => {
    projectRepo.findById.mockResolvedValue({
      ...project('root'),
      status: 'archived',
    });
    expect(await service.discardProject('p_root')).toEqual({
      affectedContentItemIds: [],
      deleted: 0,
    });
    expect(
      editorDraftRepo.deleteAiDraftsByContentItemIds,
    ).not.toHaveBeenCalled();
  });

  it('rejects missing projects', async () => {
    projectRepo.findById.mockResolvedValue(null);
    await expect(service.discardProject('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
