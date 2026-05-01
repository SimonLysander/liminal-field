import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContentGitService } from '../content-git.service';
import { ContentRepoService } from '../content-repo.service';
import { ContentRepository } from '../content.repository';
import { ContentService } from '../content.service';
import { ContentVisibility } from '../dto/content-query.dto';
import { ContentSaveAction } from '../dto/save-content.dto';

describe('ContentService', () => {
  let service: ContentService;
  let contentRepository: jest.Mocked<ContentRepository>;
  let contentRepoService: jest.Mocked<ContentRepoService>;
  let contentGitService: jest.Mocked<ContentGitService>;

  beforeEach(() => {
    contentRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      list: jest.fn(),
      listAll: jest.fn(),
    } as unknown as jest.Mocked<ContentRepository>;

    contentRepoService = {
      writeMainMarkdown: jest.fn(),
      readContentSource: jest.fn(),
      writeReadme: jest.fn(),
      ensureContentScaffold: jest.fn(),
    } as unknown as jest.Mocked<ContentRepoService>;

    contentGitService = {
      prepareWritableWorkspace: jest.fn(),
      recordCommittedContentChange: jest.fn(),
      listContentHistory: jest.fn(),
    } as unknown as jest.Mocked<ContentGitService>;

    service = new ContentService(
      contentRepository,
      contentRepoService,
      contentGitService,
    );
  });

  it('returns public content detail from the published version pointer', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        commitHash: 'latest123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
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
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# Published body',
      plainText: 'Published body',
      assetRefs: [{ path: './assets/cover.png', type: 'image' }],
    });

    const result = await service.getContentById('ci_test');

    expect(contentRepoService.readContentSource.mock.calls).toEqual([
      ['ci_test', { commitHash: 'published123' }],
    ]);
    expect(result).toMatchObject({
      id: 'ci_test',
      title: 'Published title',
      summary: 'Published summary',
      status: 'published',
      latestVersion: {
        commitHash: 'latest123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        commitHash: 'published123',
        title: 'Published title',
        summary: 'Published summary',
      },
      latestCommitHash: 'latest123',
      publishedCommitHash: 'published123',
      hasUnpublishedChanges: true,
      bodyMarkdown: '# Published body',
      plainText: 'Published body',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(result.assetRefs).toEqual([
      { path: './assets/cover.png', type: 'image' },
    ]);
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
        commitHash: 'latest123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        commitHash: 'published123',
        title: 'Published title',
        summary: 'Published summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# Latest committed body',
      plainText: 'Latest committed body',
      assetRefs: [],
    });

    const result = await service.getContentById('ci_test', {
      visibility: ContentVisibility.all,
    });

    expect(contentRepoService.readContentSource.mock.calls).toEqual([
      ['ci_test', { commitHash: undefined }],
    ]);
    expect(result).toMatchObject({
      title: 'Latest committed title',
      summary: 'Latest committed summary',
      status: 'published',
      latestCommitHash: 'latest123',
      publishedCommitHash: 'published123',
      hasUnpublishedChanges: true,
    });
  });

  it('prepares the git-backed workspace and creates an initial formal version on content creation', async () => {
    const now = new Date('2026-04-20T08:00:00.000Z');
    contentRepository.create.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        commitHash: 'init123',
        title: 'React Hooks Intro',
        summary: 'Hooks summary',
      },
      publishedVersion: null,
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# Title',
      plainText: 'Title',
      assetRefs: [],
    });
    contentGitService.recordCommittedContentChange.mockResolvedValue('init123');

    await service.createContent({
      title: 'React Hooks Intro',
      summary: 'Hooks summary',
      status: 'committed' as never,
      bodyMarkdown: '# Title',
    });

    expect(contentGitService.prepareWritableWorkspace.mock.calls).toEqual([[]]);
    expect(
      contentGitService.recordCommittedContentChange.mock.calls,
    ).toHaveLength(1);
    expect(
      contentGitService.recordCommittedContentChange.mock.calls[0]?.[1],
    ).toBe('Initial content creation');
    expect(contentRepository.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        latestVersion: {
          commitHash: 'init123',
          title: 'React Hooks Intro',
          summary: 'Hooks summary',
        },
        publishedVersion: null,
      }),
    );
  });

  it('hides committed content from public detail queries by default', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
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
        commitHash: 'head123',
        title: 'Committed article',
        summary: 'Committed summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# Committed',
      plainText: 'Committed',
      assetRefs: [],
    });

    const result = await service.getContentById('ci_test', {
      visibility: ContentVisibility.all,
    });

    expect(result).toMatchObject({
      id: 'ci_test',
      status: 'committed',
      latestCommitHash: 'head123',
      hasUnpublishedChanges: false,
    });
  });

  it('searches plain text when title and summary do not match', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    contentRepository.listAll.mockResolvedValue([
      {
        id: 'ci_test',
        latestVersion: {
          commitHash: 'latest123',
          title: 'React Hooks Intro',
          summary: 'Hooks summary',
        },
        publishedVersion: {
          commitHash: 'published123',
          title: 'Published hooks intro',
          summary: 'Published hooks summary',
        },
        changeLogs: [],
        createdAt: now,
        updatedAt: now,
      },
    ] as never);
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# Title',
      plainText: 'Detailed explanation of suspense boundaries',
      assetRefs: [],
    });

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

  it('returns content history through the git service', async () => {
    const now = new Date('2026-04-20T08:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        commitHash: 'abc123',
        title: 'History article',
        summary: 'History summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    contentGitService.listContentHistory.mockResolvedValue([
      {
        commitHash: 'abc123',
        committedAt: now.toISOString(),
        authorName: 'Liminal Field',
        authorEmail: 'no-reply@liminal-field.local',
        message: 'content(ci_test): Commit history',
        action: 'commit',
      },
    ] as never);

    const result = await service.getContentHistory('ci_test');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      commitHash: 'abc123',
      action: 'commit',
    });
  });

  it('records a git commit and updates latest pointers for explicit commit actions', async () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      _id: 'ci_test',
      id: 'ci_test',
      latestVersion: {
        commitHash: 'before123',
        title: 'Before',
        summary: 'Before',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
      toObject() { return this; },
    } as never);
    contentRepository.update.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        commitHash: 'after123',
        title: 'After',
        summary: 'After',
      },
      publishedVersion: null,
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# After',
      plainText: 'After',
      assetRefs: [],
    });
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

    expect(contentGitService.recordCommittedContentChange.mock.calls).toEqual([
      ['ci_test', 'Commit committed content'],
    ]);
    expect(contentRepository.update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        latestVersion: {
          commitHash: 'after123',
          title: 'After',
          summary: 'After',
        },
        publishedVersion: null,
      }),
    );
  });

  it('publishes a committed version by moving the public pointer without writing git', async () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      _id: 'ci_test',
      id: 'ci_test',
      latestVersion: {
        commitHash: 'after123',
        title: 'Committed title',
        summary: 'Committed summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
      toObject() { return this; },
    } as never);
    contentRepository.update.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        commitHash: 'after123',
        title: 'Committed title',
        summary: 'Committed summary',
      },
      publishedVersion: {
        commitHash: 'after123',
        title: 'Committed title',
        summary: 'Committed summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# After',
      plainText: 'After',
      assetRefs: [],
    });

    await service.saveContent('ci_test', {
      title: 'stale title from formal page',
      summary: 'stale summary from formal page',
      status: 'published' as never,
      bodyMarkdown: '# stale body',
      changeNote: 'Publish content',
      action: ContentSaveAction.publish,
    });

    expect(contentGitService.recordCommittedContentChange.mock.calls).toEqual(
      [],
    );
    expect(contentRepoService.writeMainMarkdown.mock.calls).toEqual([]);
    expect(contentRepository.update.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        latestVersion: {
          commitHash: 'after123',
          title: 'Committed title',
          summary: 'Committed summary',
        },
        publishedVersion: {
          commitHash: 'after123',
          title: 'Committed title',
          summary: 'Committed summary',
        },
      }),
    );
  });

  it('rejects publish when the current formal state is already published and no newer version exists', async () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    contentRepository.findById.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        commitHash: 'published123',
        title: 'Published article',
        summary: 'Published summary',
      },
      publishedVersion: {
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
        commitHash: 'published123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        commitHash: 'published123',
        title: 'Published article',
        summary: 'Published summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
      toObject() { return this; },
    } as never);
    contentRepository.update.mockResolvedValue({
      id: 'ci_test',
      latestVersion: {
        commitHash: 'new123',
        title: 'Latest committed title',
        summary: 'Latest committed summary',
      },
      publishedVersion: {
        commitHash: 'published123',
        title: 'Published article',
        summary: 'Published summary',
      },
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    contentRepoService.readContentSource.mockResolvedValue({
      bodyMarkdown: '# Changed',
      plainText: 'Changed',
      assetRefs: [],
    });
    contentGitService.recordCommittedContentChange.mockResolvedValue('new123');

    const result = await service.saveContent('ci_test', {
      title: 'Latest committed title',
      summary: 'Latest committed summary',
      status: 'published' as never,
      bodyMarkdown: '# Changed',
      changeNote: 'Commit from published',
      action: ContentSaveAction.commit,
    });

    expect(contentGitService.recordCommittedContentChange.mock.calls).toEqual([
      ['ci_test', 'Commit from published'],
    ]);
    expect(result).toMatchObject({
      status: 'published',
      latestCommitHash: 'new123',
      publishedCommitHash: 'published123',
      hasUnpublishedChanges: true,
    });
  });
});
