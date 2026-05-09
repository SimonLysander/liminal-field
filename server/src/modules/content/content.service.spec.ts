import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContentService } from './content.service';

// ─── Helper：构造最简 ContentItem mock 对象 ──────────────────────────────────

/**
 * buildContentItem — 创建满足 ContentService 方法调用需求的最小 mock。
 * toObject() 供 saveContent 内部的 spread 使用，返回自身即可。
 */
function buildContentItem(overrides: {
  id?: string;
  latestCommitHash?: string;
  publishedCommitHash?: string | null;
}) {
  const id = overrides.id ?? 'ci_test001';
  const latestHash = overrides.latestCommitHash ?? 'abc123';
  const publishedHash = overrides.publishedCommitHash;

  const item: Record<string, unknown> = {
    _id: id,
    id,
    latestVersion: {
      versionId: 'test-vid-001',
      commitHash: latestHash,
      title: '测试标题',
      summary: '摘要',
    },
    publishedVersion:
      publishedHash !== undefined
        ? publishedHash === null
          ? null
          : { commitHash: publishedHash, title: '测试标题', summary: '' }
        : null,
    changeLogs: [],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    toObject() {
      return this;
    },
  };
  return item;
}

// ─── Mock 工厂 ───────────────────────────────────────────────────────────────

function createMocks() {
  const mockRepository = {
    findById: jest.fn(),
    update: jest.fn(),
  };

  // ContentRepoService 和 ContentGitService 在 publishVersion / unpublishVersion 中未被调用，
  // 传空对象即可满足构造函数要求。
  const mockRepoService = {} as never;
  const mockGitService = {} as never;
  const mockSnapshotRepository = {
    listByContentItemId: jest.fn().mockResolvedValue([]),
    findByVersionId: jest.fn().mockImplementation((vid: string) =>
      Promise.resolve({ _id: vid, versionId: vid, title: '测试标题', summary: '摘要', bodyMarkdown: '', commitHash: 'latest-hash', createdAt: new Date() }),
    ),
  };

  const mockOssService = {
    isDraftStorageReady: jest.fn().mockReturnValue(false),
    getPublicUrl: jest
      .fn()
      .mockImplementation((key: string) => `/mock-oss/${key}`),
  };
  const service = new ContentService(
    mockRepository as never,
    mockRepoService,
    mockGitService,
    mockSnapshotRepository as never,
    mockOssService as never,
  );

  return { service, mockRepository };
}

// ─── publishVersion ──────────────────────────────────────────────────────────

describe('ContentService.publishVersion', () => {
  it('正常发布 latestVersion（不传 commitHash）→ publishedVersion 指向 latestVersion 的 hash', async () => {
    const { service, mockRepository } = createMocks();
    const item = buildContentItem({ latestCommitHash: 'latest-hash' });
    mockRepository.findById.mockResolvedValue(item);
    mockRepository.update.mockResolvedValue(item);

    await service.publishVersion('ci_test001');

    expect(mockRepository.update).toHaveBeenCalledWith(
      'ci_test001',
      expect.objectContaining({
        publishedVersion: expect.objectContaining({
          commitHash: 'latest-hash',
        }),
      }),
    );
  });

  it('发布指定 versionId → publishedVersion.versionId = 传入的 versionId', async () => {
    const { service, mockRepository } = createMocks();
    const item = buildContentItem({ latestCommitHash: 'latest-hash' });
    mockRepository.findById.mockResolvedValue(item);
    mockRepository.update.mockResolvedValue(item);

    await service.publishVersion('ci_test001', 'specific-vid');

    expect(mockRepository.update).toHaveBeenCalledWith(
      'ci_test001',
      expect.objectContaining({
        publishedVersion: expect.objectContaining({
          versionId: 'specific-vid',
        }),
      }),
    );
  });

  it('内容不存在 → 抛 NotFoundException', async () => {
    const { service, mockRepository } = createMocks();
    mockRepository.findById.mockResolvedValue(null);

    await expect(service.publishVersion('ci_missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('V2: latestVersion 没有 versionId → 抛 BadRequestException', async () => {
    const { service, mockRepository } = createMocks();
    const item = buildContentItem({ latestCommitHash: '' });
    // V2: 移除 versionId 模拟从未创建 snapshot 的情况
    (item.latestVersion as Record<string, unknown>).versionId = undefined;
    mockRepository.findById.mockResolvedValue(item);

    await expect(service.publishVersion('ci_test001')).rejects.toThrow(
      BadRequestException,
    );
  });
});

// ─── unpublishVersion ────────────────────────────────────────────────────────

describe('ContentService.unpublishVersion', () => {
  it('正常取消发布 → publishedVersion 设为 null', async () => {
    const { service, mockRepository } = createMocks();
    const item = buildContentItem({
      latestCommitHash: 'latest-hash',
      publishedCommitHash: 'pub-hash',
    });
    mockRepository.findById.mockResolvedValue(item);
    mockRepository.update.mockResolvedValue(item);

    await service.unpublishVersion('ci_test001');

    expect(mockRepository.update).toHaveBeenCalledWith(
      'ci_test001',
      expect.objectContaining({ publishedVersion: null }),
    );
  });

  it('内容未发布 → 抛 BadRequestException', async () => {
    const { service, mockRepository } = createMocks();
    const item = buildContentItem({ publishedCommitHash: null }); // 未发布
    mockRepository.findById.mockResolvedValue(item);

    await expect(service.unpublishVersion('ci_test001')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('内容不存在 → 抛 NotFoundException', async () => {
    const { service, mockRepository } = createMocks();
    mockRepository.findById.mockResolvedValue(null);

    await expect(service.unpublishVersion('ci_missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});
