import { NavigationNodeController } from '../navigation.controller';
import { NavigationNodeService } from '../navigation.service';
import { StructureMutationService } from '../../structure/structure-mutation.service';

describe('NavigationNodeController', () => {
  let controller: NavigationNodeController;
  let navigationNodeService: jest.Mocked<NavigationNodeService>;
  let structureMutationService: jest.Mocked<StructureMutationService>;

  beforeEach(() => {
    navigationNodeService = {
      createStructureNode: jest.fn(),
      listStructureNodes: jest.fn(),
      findStructurePathByNodeId: jest.fn(),
      findStructurePathByContentItemId: jest.fn(),
    } as unknown as jest.Mocked<NavigationNodeService>;
    structureMutationService = {
      updateStructureNode: jest.fn(),
      deleteStructureNode: jest.fn(),
    } as unknown as jest.Mocked<StructureMutationService>;

    controller = new NavigationNodeController(
      navigationNodeService,
      structureMutationService,
    );
  });

  it('delegates structure node creation to the service', async () => {
    const dto = {
      name: 'Frontend',
      type: 'FOLDER' as const,
      parentId: 'root',
      sortOrder: 1,
    };
    const expected = { id: 'node_1' };
    navigationNodeService.createStructureNode.mockResolvedValue(
      expected as never,
    );

    const result = await controller.createStructureNode(dto);

    expect(result).toBe(expected);
    expect(navigationNodeService.createStructureNode.mock.calls).toEqual([
      [dto],
    ]);
  });

  it('delegates structure path lookup to the service', async () => {
    const expected = [{ id: 'root' }, { id: 'child' }];
    navigationNodeService.findStructurePathByNodeId.mockResolvedValue(
      expected as never,
    );

    const result = await controller.getStructurePathByNodeId('child');

    expect(result).toBe(expected);
    expect(navigationNodeService.findStructurePathByNodeId.mock.calls).toEqual([
      ['child'],
    ]);
  });

  it('delegates structure mutations to the coordinator', async () => {
    const dto = { parentId: 'target' };
    structureMutationService.updateStructureNode.mockResolvedValue({
      id: 'node',
    } as never);

    await controller.updateStructureNode('node', dto);
    await controller.deleteStructureNode('node');

    expect(structureMutationService.updateStructureNode).toHaveBeenCalledWith(
      'node',
      dto,
    );
    expect(structureMutationService.deleteStructureNode).toHaveBeenCalledWith(
      'node',
    );
  });

  it('passes visibility through when listing structure nodes', async () => {
    navigationNodeService.listStructureNodes.mockResolvedValue({
      path: [],
      children: [],
    });

    const mockRequest = { user: { sub: 'admin' } } as any;
    await controller.listStructureNodes(
      'root',
      'all' as never,
      undefined,
      mockRequest,
    );

    expect(navigationNodeService.listStructureNodes.mock.calls).toEqual([
      ['root', 'all', undefined],
    ]);
  });
});
