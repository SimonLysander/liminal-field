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
    // importContent / createContent 调用 contentRepository.create
    create: jest.fn(),
  };

  // ContentRepoService 和 ContentGitService 在 publishVersion / unpublishVersion 中未被调用，
  // 传空对象即可满足构造函数要求。
  // getContentByVersion commitHash fallback 路径需要 readContentSource，局部覆盖即可。
  const mockRepoService = {} as never;
  const mockGitService = {} as never;
  const mockSnapshotRepository = {
    listByContentItemId: jest.fn().mockResolvedValue([]),
    findByVersionId: jest.fn().mockImplementation((vid: string) =>
      Promise.resolve({
        _id: vid,
        versionId: vid,
        title: '测试标题',
        summary: '摘要',
        bodyMarkdown: '',
        commitHash: 'latest-hash',
        createdAt: new Date(),
      }),
    ),
    // importContent / saveContent / createContent 均调用 snapshotRepository.create
    create: jest.fn().mockResolvedValue(undefined),
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

  return { service, mockRepository, mockSnapshotRepository };
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

// ─── importContent ───────────────────────────────────────────────────────────

describe('ContentService.importContent', () => {
  it('创建 snapshot + contentItem，返回 contentId 和 versionId', async () => {
    const { service, mockRepository, mockSnapshotRepository } = createMocks();
    // contentRepository.create 返回新建的 ContentItem
    mockRepository.create.mockResolvedValue(
      buildContentItem({ latestCommitHash: '' }),
    );

    const result = await service.importContent({
      title: '导入标题',
      bodyMarkdown: '# 导入正文',
      changeNote: '初始导入',
    });

    // 返回值包含 contentId 和 versionId
    expect(result).toHaveProperty('contentId');
    expect(result).toHaveProperty('versionId');
    expect(typeof result.contentId).toBe('string');
    expect(typeof result.versionId).toBe('string');

    // snapshot 必须被创建
    expect(mockSnapshotRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '导入标题',
        bodyMarkdown: '# 导入正文',
        changeNote: '初始导入',
      }),
    );

    // contentItem 必须被创建
    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        latestVersion: expect.objectContaining({ title: '导入标题' }),
      }),
    );
  });

  it('可选传入 contentId，用传入值而非自动生成', async () => {
    const { service, mockRepository, mockSnapshotRepository } = createMocks();
    mockRepository.create.mockResolvedValue(
      buildContentItem({ id: 'ci_imported001', latestCommitHash: '' }),
    );

    const result = await service.importContent({
      contentId: 'ci_imported001',
      title: '指定 ID 导入',
      bodyMarkdown: '正文',
      changeNote: '导入',
    });

    // 返回的 contentId 必须等于传入值
    expect(result.contentId).toBe('ci_imported001');

    // snapshot 和 contentItem 均使用指定 contentId
    expect(mockSnapshotRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contentItemId: 'ci_imported001' }),
    );
    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ci_imported001' }),
    );
  });

  it('changeLogs 使用 major changeType', async () => {
    const { service, mockRepository } = createMocks();
    mockRepository.create.mockResolvedValue(
      buildContentItem({ latestCommitHash: '' }),
    );

    await service.importContent({
      title: '验证 changeType',
      bodyMarkdown: '',
      changeNote: '首次导入',
    });

    // contentRepository.create 时传入的 changeLogs[0].changeType 应为 major
    const createArg = mockRepository.create.mock.calls[0][0] as {
      changeLogs: Array<{ changeType: string }>;
    };
    expect(createArg.changeLogs).toHaveLength(1);
    expect(createArg.changeLogs[0].changeType).toBe('major');
  });
});

// ─── getContentHistory ───────────────────────────────────────────────────────

describe('ContentService.getContentHistory', () => {
  it('从 snapshot 列表构建历史，不依赖 Git', async () => {
    const { service, mockRepository, mockSnapshotRepository } = createMocks();
    const item = buildContentItem({ latestCommitHash: 'abc' });

    // 两个快照：createdAt 故意对齐 changeLogs 以触发 log 匹配逻辑
    const createdAt1 = new Date('2024-03-01T10:00:00Z');
    const createdAt2 = new Date('2024-04-01T10:00:00Z');
    (item.changeLogs as unknown[]) = [
      {
        commitHash: 'hash2',
        title: '第二版',
        summary: '',
        changeType: 'minor',
        changeNote: '增加段落',
        createdAt: createdAt2,
      },
      {
        commitHash: 'hash1',
        title: '第一版',
        summary: '',
        changeType: 'major',
        changeNote: '初稿',
        createdAt: createdAt1,
      },
    ];

    mockRepository.findById.mockResolvedValue(item);
    mockSnapshotRepository.listByContentItemId.mockResolvedValue([
      {
        versionId: 'vid-001',
        commitHash: 'hash1',
        title: '第一版',
        createdAt: createdAt1,
        changeNote: '初稿',
      },
      {
        versionId: 'vid-002',
        commitHash: 'hash2',
        title: '第二版',
        createdAt: createdAt2,
        changeNote: '增加段落',
      },
    ]);

    const history = await service.getContentHistory('ci_test001');

    // 两条记录均出现，且不需要 Git 调用
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      versionId: 'vid-001',
      commitHash: 'hash1',
      changeNote: '初稿',
      changeType: 'major',
    });
    expect(history[1]).toMatchObject({
      versionId: 'vid-002',
      commitHash: 'hash2',
      changeNote: '增加段落',
      changeType: 'minor',
    });
  });

  it('内容不存在时抛 NotFoundException', async () => {
    const { service, mockRepository } = createMocks();
    mockRepository.findById.mockResolvedValue(null);

    await expect(service.getContentHistory('ci_missing')).rejects.toThrow(
      NotFoundException,
    );
  });
});

// ─── getContentByVersion ─────────────────────────────────────────────────────

describe('ContentService.getContentByVersion', () => {
  it('按 versionId 查找 snapshot 并返回详情', async () => {
    const { service, mockRepository, mockSnapshotRepository } = createMocks();
    const item = buildContentItem({ latestCommitHash: 'abc' });
    mockRepository.findById.mockResolvedValue(item);

    // findByVersionId 命中
    mockSnapshotRepository.findByVersionId.mockResolvedValue({
      versionId: 'vid-001',
      commitHash: 'abc',
      title: '版本标题',
      summary: '摘要',
      bodyMarkdown: '# 正文内容',
      createdAt: new Date(),
    });

    const detail = await service.getContentByVersion('ci_test001', 'vid-001');

    expect(detail.bodyMarkdown).toBe('# 正文内容');
    // 确认走的是 snapshot 路径，listByContentItemId 不应被调用
    expect(mockSnapshotRepository.listByContentItemId).not.toHaveBeenCalled();
  });

  it('按 commitHash 回退查找', async () => {
    const { service, mockRepository, mockSnapshotRepository } = createMocks();
    const item = buildContentItem({ latestCommitHash: 'deadbeef' });
    mockRepository.findById.mockResolvedValue(item);

    // versionId 查找未命中
    mockSnapshotRepository.findByVersionId.mockResolvedValue(null);

    // commitHash 回退查找命中
    mockSnapshotRepository.listByContentItemId.mockResolvedValue([
      {
        versionId: 'vid-old',
        commitHash: 'deadbeef',
        title: '历史版本',
        summary: '',
        bodyMarkdown: '历史正文',
        createdAt: new Date(),
      },
    ]);

    const detail = await service.getContentByVersion('ci_test001', 'deadbeef');

    expect(detail.bodyMarkdown).toBe('历史正文');
    expect(mockSnapshotRepository.listByContentItemId).toHaveBeenCalledWith(
      'ci_test001',
    );
  });

  it('内容不存在时抛 NotFoundException', async () => {
    const { service, mockRepository } = createMocks();
    mockRepository.findById.mockResolvedValue(null);

    await expect(
      service.getContentByVersion('ci_missing', 'any-vid'),
    ).rejects.toThrow(NotFoundException);
  });
});
