import { NotFoundException } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';

// ─── Mock 工厂 ───────────────────────────────────────────────────────────────

function createMocks() {
  const mockContentService = {
    publishVersion: jest.fn(),
    unpublishVersion: jest.fn(),
  };

  const mockContentRepository = {
    findById: jest.fn(),
  };

  const mockContentRepoService = {
    listAssets: jest.fn(),
  };

  const mockNavigationRepository = {
    findByContentItemId: jest.fn(),
  };

  const service = new WorkspaceService(
    mockContentService as never,
    mockContentRepository as never,
    mockContentRepoService as never,
    mockNavigationRepository as never,
  );

  return {
    service,
    mockContentService,
    mockContentRepository,
    mockContentRepoService,
    mockNavigationRepository,
  };
}

// ─── assertScopeMatch ────────────────────────────────────────────────────────

describe('WorkspaceService.assertScopeMatch', () => {
  it('导航节点存在且 scope 匹配 → 不抛错', async () => {
    const { service, mockNavigationRepository } = createMocks();
    mockNavigationRepository.findByContentItemId.mockResolvedValue({
      scope: 'gallery',
      contentItemId: 'ci_001',
    });

    await expect(
      service.assertScopeMatch('gallery', 'ci_001'),
    ).resolves.toBeUndefined();
  });

  it('导航节点存在但 scope 不匹配 → 抛 NotFoundException', async () => {
    const { service, mockNavigationRepository } = createMocks();
    mockNavigationRepository.findByContentItemId.mockResolvedValue({
      scope: 'notes',
      contentItemId: 'ci_001',
    });

    await expect(service.assertScopeMatch('gallery', 'ci_001')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('导航节点不存在 → 抛 NotFoundException', async () => {
    const { service, mockNavigationRepository } = createMocks();
    mockNavigationRepository.findByContentItemId.mockResolvedValue(null);

    await expect(
      service.assertScopeMatch('gallery', 'ci_missing'),
    ).rejects.toThrow(NotFoundException);
  });
});

// ─── publish ────────────────────────────────────────────────────────────────
//
// WorkspaceService.publish 是纯指针操作（不写 Git），直接委托 publishVersion。
// gallery 空照片校验已移至 GalleryViewService.assertPublishable，由 controller 层调用。

describe('WorkspaceService.publish', () => {
  it('gallery scope → 直接调 publishVersion，不调 listAssets', async () => {
    const { service, mockContentService, mockContentRepoService } =
      createMocks();
    mockContentService.publishVersion.mockResolvedValue(undefined);

    await service.publish('gallery', 'ci_001');

    // publish 不再负责照片校验（已移至 GalleryViewService.assertPublishable）
    expect(mockContentRepoService.listAssets).not.toHaveBeenCalled();
    expect(mockContentService.publishVersion).toHaveBeenCalledWith(
      'ci_001',
      undefined,
    );
  });

  it('notes scope → 直接调 publishVersion', async () => {
    const { service, mockContentService, mockContentRepoService } =
      createMocks();
    mockContentService.publishVersion.mockResolvedValue(undefined);

    await service.publish('notes', 'ci_002');

    expect(mockContentRepoService.listAssets).not.toHaveBeenCalled();
    expect(mockContentService.publishVersion).toHaveBeenCalledWith(
      'ci_002',
      undefined,
    );
  });

  it('传入 commitHash → 转发给 publishVersion', async () => {
    const { service, mockContentService } = createMocks();
    mockContentService.publishVersion.mockResolvedValue(undefined);

    await service.publish('gallery', 'ci_001', 'abc1234');

    expect(mockContentService.publishVersion).toHaveBeenCalledWith(
      'ci_001',
      'abc1234',
    );
  });
});
