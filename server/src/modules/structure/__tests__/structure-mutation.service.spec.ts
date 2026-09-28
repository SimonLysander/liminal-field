import { LearningProjectService } from '../../learning/learning-project.service';
import { NavigationNodeService } from '../../navigation/navigation.service';
import { NavigationTopologyLockService } from '../../navigation/navigation-topology-lock.service';
import { StructureMutationService } from '../structure-mutation.service';

describe('StructureMutationService', () => {
  let service: StructureMutationService;
  let navigationService: jest.Mocked<NavigationNodeService>;
  let learningProjectService: jest.Mocked<LearningProjectService>;
  let topologyLock: jest.Mocked<NavigationTopologyLockService>;

  beforeEach(() => {
    navigationService = {
      updateStructureNode: jest.fn(),
      deleteNavigationNodeById: jest.fn(),
    } as unknown as jest.Mocked<NavigationNodeService>;
    learningProjectService = {
      assertDeleteAllowed: jest.fn(),
    } as unknown as jest.Mocked<LearningProjectService>;
    topologyLock = {
      runExclusive: jest.fn((operation: () => Promise<unknown>) => operation()),
    } as unknown as jest.Mocked<NavigationTopologyLockService>;

    service = new StructureMutationService(
      navigationService,
      learningProjectService,
      topologyLock,
    );
  });

  it('updates non-topology fields without taking the topology lock', async () => {
    navigationService.updateStructureNode.mockResolvedValue({
      id: 'node',
    } as never);

    await service.updateStructureNode('node', { name: '新名称' });

    expect(topologyLock.runExclusive).not.toHaveBeenCalled();
    expect(navigationService.updateStructureNode).toHaveBeenCalledWith('node', {
      name: '新名称',
    });
  });

  it('serializes reparenting without forbidding nested learning projects', async () => {
    navigationService.updateStructureNode.mockResolvedValue({
      id: 'node',
    } as never);

    await service.updateStructureNode('node', { parentId: 'target' });

    expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
    expect(navigationService.updateStructureNode).toHaveBeenCalledWith('node', {
      parentId: 'target',
    });
  });

  it('still propagates navigation cycle validation failures', async () => {
    navigationService.updateStructureNode.mockRejectedValue(new Error('cycle'));

    await expect(
      service.updateStructureNode('node', { parentId: 'target' }),
    ).rejects.toThrow('cycle');

    expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
  });

  it('validates deletion before removing the subtree', async () => {
    await service.deleteStructureNode('node');

    expect(topologyLock.runExclusive).toHaveBeenCalledTimes(1);
    expect(learningProjectService.assertDeleteAllowed).toHaveBeenCalledWith(
      'node',
    );
    expect(navigationService.deleteNavigationNodeById).toHaveBeenCalledWith(
      'node',
    );
  });
});
