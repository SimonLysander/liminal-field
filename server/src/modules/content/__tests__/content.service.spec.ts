import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContentGitService } from '../content-git.service';
import { ContentRepoService } from '../content-repo.service';
import { ContentRepository } from '../content.repository';
import { ContentService } from '../content.service';
import { ContentVisibility } from '../dto/content-query.dto';
import { ContentSaveAction } from '../dto/save-content.dto';
import type { ContentSnapshotRepository } from '../content-snapshot.repository';
import type { OssService } from '../../oss/oss.service';

describe('ContentService', () => {
  let service: ContentService;
  let contentRepository: jest.Mocked<ContentRepository>;
  let contentRepoService: jest.Mocked<ContentRepoService>;
  let contentGitService: jest.Mocked<ContentGitService>;
  let snapshotRepository: jest.Mocked<ContentSnapshotRepository>;
  let ossService: jest.Mocked<OssService>;

  beforeEach(() => {
    contentRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      listAll: jest.fn(),
      // V2: searchByKeyword 被 twoPhaseSearch 调用，必须 mock
      searchByKeyword: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ContentRepository>;

    contentRepoService = {
      writeMainMarkdown: jest.fn(),
      readContentSource: jest.fn(),
      writeReadme: jest.fn(),
      ensureContentScaffold: jest.fn(),
      // V2: saveContent 调用此方法提取资源引用，必须 mock
      extractAssetRefs: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ContentRepoService>;

    contentGitService = {
      prepareWritableWorkspace: jest.fn(),
      recordCommittedContentChange: jest.fn(),
      listContentHistory: jest.fn(),
    } as unknown as jest.Mocked<ContentGitService>;

    snapshotRepository = {
      findByVersionId: jest.fn(),
      create: jest.fn(),
      listByContentItemId: jest.fn().mockResolvedValue([]),
      findPendingArchive: jest.fn().mockResolvedValue([]),
      backfillCommitHash: jest.fn().mockResolvedValue(undefined),
      // V2 twoPhaseSearch 需要此方法搜索正文关键字
      searchContentIdsByBodyKeyword: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<ContentSnapshotRepository>;

    ossService = {
      isDraftStorageReady: jest.fn().mockReturnValue(false),
      getPublicUrl: jest
        .fn()
        .mockImplementation((key: string) => `/mock-oss/${key}`),
    } as unknown as jest.Mocked<OssService>;

    service = new ContentService(
      contentRepository,
      contentRepoService,
      contentGitService,
      snapshotRepository,
      ossService,
      // navigationModel：本测试套件不测 navigation 相关，传空 mock
      {} as never,
    );
  });

  it('returns public content detail from the published version pointer', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    // V2: latestVersion / publishedVersion 必须带 versionId（hasUnpublishedChanges 用 versionId 比较）
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_latest',
        commitHash: 'latest123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Published title',
        summary: 'Published summary',
      },
      changeLogs: [
        {
          commitHash: 'latest123',
          title: 'Latest committed title',
          summary: 'Latest committed summary',
          createdAt: now,
          changeType: 'patch',
          changeNote: 'Refined examples',
        },
      ],
      createdAt: now,
      updatedAt: now,
    } as never);
    // V2: getContentById 从 snapshotRepository 读正文，而非 readContentSource
    snapshotRepository.findByVersionId.mockResolvedValue({
      versionId: 'vid_published',
      bodyMarkdown: '# Published body',
      title: 'Published title',
      summary: 'Published summary',
      createdAt: now,
    } as never);

    const result = await service.getContentById('ci_test');

    // V2: 公开视图读 publishedVersion.versionId 对应的 snapshot
    expect(snapshotRepository.findByVersionId).toHaveBeenCalledWith(
      'vid_published',
    );
    expect(result).toMatchObject({
      id: 'ci_test',
      title: 'Published title',
      summary: 'Published summary',
      status: 'published',
      latestVersion: expect.objectContaining({
        commitHash: 'latest123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      }),
      publishedVersion: expect.objectContaining({
        commitHash: 'published123',
        title: 'Published title',
        summary: 'Published summary',
      }),
      hasUnpublishedChanges: true, // versionId 不同 → 有未发布改动
      bodyMarkdown: '# Published body',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(result.changeLogs).toEqual([
      {
        commitHash: 'latest123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
        createdAt: now.toISOString(),
        changeType: 'patch',
        changeNote: 'Refined examples',
      },
    ]);
  });

  it('returns admin content detail from the latest committed head', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_latest',
        commitHash: 'latest123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Published title',
        summary: 'Published summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    // V2: admin 视图读 latestVersion.versionId 对应的 snapshot
    snapshotRepository.findByVersionId.mockResolvedValue({
      versionId: 'vid_latest',
      bodyMarkdown: '# Latest committed body',
      title: 'Latest committed title',
      summary: 'Latest committed summary',
      createdAt: now,
    } as never);

    const result = await service.getContentById('ci_test', {
      visibility: ContentVisibility.all,
    });

    // admin 视图传 latestVersion.versionId
    expect(snapshotRepository.findByVersionId).toHaveBeenCalledWith(
      'vid_latest',
    );
    expect(result).toMatchObject({
      title: 'Latest committed title',
      summary: 'Latest committed summary',
      status: 'published',
      hasUnpublishedChanges: true,
    });
  });

  it('prepares the git-backed workspace and creates an initial formal version on content creation', async () => {
    const now = new Date('2026-04-20T08:00:00.000Z');
    contentRepository.create.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_init',
        commitHash: '',
        title: 'React Hooks Intro',
        summary: 'Hooks summary',
      },
      publishedVersion: null,
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    // V2: createContent 先写初始 snapshot 再建 ContentItem，snapshot.create 须有合理返回
    snapshotRepository.create.mockResolvedValue({} as never);

    await service.createContent({
      title: 'React Hooks Intro',
      summary: 'Hooks summary',
    });

    /* createContent 只建 MongoDB，不碰 Git */
    expect(contentGitService.prepareWritableWorkspace.mock.calls).toEqual([]);
    expect(
      contentGitService.recordCommittedContentChange.mock.calls,
    ).toHaveLength(0);

    // V2: create 载荷包含 versionId，commitHash 初始为空字符串
    expect(contentRepository.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        latestVersion: expect.objectContaining({
          commitHash: '',
          title: 'React Hooks Intro',
          summary: 'Hooks summary',
        }),
        publishedVersion: null,
        changeLogs: [],
      }),
    );
  });

  it('hides committed content from public detail queries by default', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_head',
        commitHash: 'head123',
        title: 'Committed article',
        summary: 'Committed summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);

    await expect(service.getContentById('ci_test')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('allows admin detail queries to read committed content explicitly', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_head',
        commitHash: 'head123',
        title: 'Committed article',
        summary: 'Committed summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    snapshotRepository.findByVersionId.mockResolvedValue({
      versionId: 'vid_head',
      bodyMarkdown: '# Committed',
      title: 'Committed article',
      summary: 'Committed summary',
      createdAt: now,
    } as never);

    const result = await service.getContentById('ci_test', {
      visibility: ContentVisibility.all,
    });

    expect(result).toMatchObject({
      id: 'ci_test',
      // publishedVersion 为 null → status = committed
      status: 'committed',
      hasUnpublishedChanges: false,
    });
  });

  it('searches plain text when title and summary do not match', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    const item = {
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_latest',
        commitHash: 'latest123',
        title: 'React Hooks Intro',
        summary: 'Hooks summary',
      },
      publishedVersion: {
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Published hooks intro',
        summary: 'Published hooks summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    };

    // 阶段1：标题/摘要搜索无结果
    contentRepository.searchByKeyword.mockResolvedValue([] as never);
    // 阶段2：正文全文搜索命中 ci_test
    snapshotRepository.searchContentIdsByBodyKeyword.mockResolvedValue([
      'ci_test',
    ]);
    // 正文搜索后按 id 回查 ContentItem
    contentRepository.findById.mockResolvedValue(item as never);

    const result = await service.searchContents({ q: 'suspense' });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'ci_test',
      title: 'Published hooks intro',
      summary: 'Published hooks summary',
    });
  });

  it('throws when saving a missing content item', async () => {
    contentRepository.findById.mockResolvedValue(null);

    await expect(
      service.saveContent('ci_missing', {
        title: 'Title',
        summary: 'Summary',
        status: 'committed' as never,
        bodyMarkdown: 'Body',
        changeNote: 'Update',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns content history through the snapshot repository', async () => {
    const now = new Date('2026-04-20T08:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_abc',
        commitHash: 'abc123',
        title: 'History article',
        summary: 'History summary',
      },
      // changeLogs 匹配 snapshot 的 changeNote 和 changeType
      changeLogs: [
        {
          createdAt: now,
          changeType: 'patch',
          changeNote: 'content(ci_test): Commit history',
        },
      ],
      createdAt: now,
      updatedAt: now,
    } as never);
    // V2: getContentHistory 从 snapshotRepository.listByContentItemId 读取
    snapshotRepository.listByContentItemId.mockResolvedValue([
      {
        versionId: 'vid_abc',
        commitHash: 'abc123',
        createdAt: now,
        changeNote: 'content(ci_test): Commit history',
        source: 'user',
        title: 'History article',
      },
    ] as never);

    const result = await service.getContentHistory('ci_test');

    expect(result).toHaveLength(1);
    // V2: history entry 字段：versionId、commitHash、changeNote、source、title
    expect(result[0]).toMatchObject({
      versionId: 'vid_abc',
      commitHash: 'abc123',
      changeNote: 'content(ci_test): Commit history',
      source: 'user',
    });
  });

  it('records a git commit and updates latest pointers for explicit commit actions', async () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      _id: 'ci_test',
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_before',
        commitHash: 'before123',
        title: 'Before',
        summary: 'Before',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
      toObject() {
        return this;
      },
    } as never);
    contentRepository.update.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_after',
        commitHash: '',
        title: 'After',
        summary: 'After',
      },
      publishedVersion: null,
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    snapshotRepository.create.mockResolvedValue({} as never);
    // archiveToGit 是 fire-and-forget，recordCommittedContentChange 在后台异步调用
    contentGitService.recordCommittedContentChange.mockResolvedValue(
      'after123',
    );

    await service.saveContent('ci_test', {
      title: 'After',
      summary: 'After',
      status: 'committed' as never,
      bodyMarkdown: '# After',
      changeNote: 'Commit committed content',
      action: ContentSaveAction.commit,
    });

    // V2: saveContent commit 先写 MongoDB（update 被调用），Git 是后台 fire-and-forget
    expect(contentRepository.update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        latestVersion: expect.objectContaining({
          commitHash: '', // 异步回填前 commitHash 为空
          title: 'After',
          summary: 'After',
        }),
        publishedVersion: null,
      }),
    );
    // snapshotRepository.create 被调用（V2 commit 先写 snapshot）
    expect(snapshotRepository.create).toHaveBeenCalled();
  });

  it('publishes a committed version by moving the public pointer without writing git', async () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      _id: 'ci_test',
      id: 'ci_test',
      latestVersion: {
        // V2: publish 必须有 versionId，否则 enforceActionStateTransition 报错
        versionId: 'vid_committed',
        commitHash: 'after123',
        title: 'Committed title',
        summary: 'Committed summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
      toObject() {
        return this;
      },
    } as never);
    contentRepository.update.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_committed',
        commitHash: 'after123',
        title: 'Committed title',
        summary: 'Committed summary',
      },
      publishedVersion: {
        versionId: 'vid_committed',
        commitHash: 'after123',
        title: 'Committed title',
        summary: 'Committed summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    // publish 操作后读 latestVersion snapshot 构建响应
    snapshotRepository.findByVersionId.mockResolvedValue({
      versionId: 'vid_committed',
      bodyMarkdown: '# After',
      title: 'Committed title',
      summary: 'Committed summary',
      createdAt: now,
    } as never);

    await service.saveContent('ci_test', {
      title: 'stale title from formal page',
      summary: 'stale summary from formal page',
      status: 'published' as never,
      bodyMarkdown: '# stale body',
      changeNote: 'Publish content',
      action: ContentSaveAction.publish,
    });

    // 发布只移动指针，不写 Git，不写 Markdown
    expect(contentGitService.recordCommittedContentChange.mock.calls).toEqual(
      [],
    );
    expect(contentRepoService.writeMainMarkdown.mock.calls).toEqual([]);
    // update 被调用，publishedVersion 指向 latestVersion
    expect(contentRepository.update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        latestVersion: expect.objectContaining({
          versionId: 'vid_committed',
          commitHash: 'after123',
          title: 'Committed title',
          summary: 'Committed summary',
        }),
        publishedVersion: expect.objectContaining({
          commitHash: 'after123',
          title: 'Committed title',
          summary: 'Committed summary',
        }),
      }),
    );
  });

  it('rejects publish when the current formal state is already published and no newer version exists', async () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        // 同一 versionId → latest 与 published 完全一致 → 不能重复发布
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Published article',
        summary: 'Published summary',
      },
      publishedVersion: {
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Published article',
        summary: 'Published summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);

    await expect(
      service.saveContent('ci_test', {
        title: 'Published article',
        summary: 'Published summary',
        status: 'published' as never,
        bodyMarkdown: '# Published',
        changeNote: 'Publish again',
        action: ContentSaveAction.publish,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps published content live while commit creates a newer unpublished version', async () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      _id: 'ci_test',
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Published article',
        summary: 'Published summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
      toObject() {
        return this;
      },
    } as never);
    contentRepository.update.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        versionId: 'vid_new',
        commitHash: '',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        versionId: 'vid_published',
        commitHash: 'published123',
        title: 'Published article',
        summary: 'Published summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    snapshotRepository.create.mockResolvedValue({} as never);
    contentGitService.recordCommittedContentChange.mockResolvedValue('new123');

    const result = await service.saveContent('ci_test', {
      title: 'Latest committed title',
      summary: 'Latest committed summary',
      status: 'published' as never,
      bodyMarkdown: '# Changed',
      changeNote: 'Commit from published',
      action: ContentSaveAction.commit,
    });

    // 新版本 versionId 不同于 publishedVersion → 有未发布改动
    expect(result).toMatchObject({
      status: 'published',
      hasUnpublishedChanges: true,
    });
    // commit 创建了新 snapshot
    expect(snapshotRepository.create).toHaveBeenCalled();
  });
});
