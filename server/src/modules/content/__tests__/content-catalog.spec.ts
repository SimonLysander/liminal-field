import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from 'nestjs-typegoose';
import { ContentService } from '../content.service';
import { ContentRepository } from '../content.repository';
import { ContentRepoService } from '../content-repo.service';
import { ContentGitService } from '../content-git.service';
import { ContentSnapshotRepository } from '../content-snapshot.repository';
import { ContentItem } from '../content-item.entity';
import { OssService } from '../../oss/oss.service';
import { NavigationNode } from '../../navigation/navigation.entity';

describe('ContentService knowledge base listing', () => {
  let service: ContentService;
  const list = jest.fn<Promise<ContentItem[]>, [unknown]>();
  const distinct = jest.fn<Promise<string[]>, [string, unknown]>();
  const find = jest.fn();
  const snapshots = { findByVersionId: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    distinct.mockResolvedValue(['ci-note']);
    list.mockResolvedValue([]);
    find.mockReturnValue({
      lean: jest
        .fn()
        .mockResolvedValue([{ contentItemId: 'ci-note', scope: 'notes' }]),
    });
    const module = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: ContentRepository, useValue: { list } },
        { provide: ContentRepoService, useValue: {} },
        { provide: ContentGitService, useValue: {} },
        { provide: ContentSnapshotRepository, useValue: snapshots },
        { provide: OssService, useValue: {} },
        {
          provide: getModelToken(NavigationNode.name),
          useValue: { distinct, find },
        },
      ],
    }).compile();
    service = module.get(ContentService);
  });

  it('applies scoped content IDs before pagination and uses limit + 1 only for lookahead', async () => {
    const item = Object.assign(new ContentItem(), {
      _id: 'ci-note',
      latestVersion: { title: '最新标题', commitHash: '' },
      publishedVersion: { title: '旧公开标题', commitHash: 'old' },
      updatedAt: new Date('2026-09-28T00:00:00Z'),
    });
    list.mockResolvedValue([item, item]);
    const result = await service.listKnowledgeBase({
      scope: 'notes',
      limit: 1,
      offset: 37,
    });
    expect(distinct).toHaveBeenCalledWith('contentItemId', { scope: 'notes' });
    expect(list).toHaveBeenCalledWith({
      contentIds: ['ci-note'],
      offset: 37,
      pageSize: 2,
    });
    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      title: '最新标题',
      contentItemId: 'ci-note',
      snippet: '',
    });
    expect(snapshots.findByVersionId).not.toHaveBeenCalled();
  });

  it('retains an empty scope filter instead of falling back to the global list', async () => {
    distinct.mockResolvedValue([]);
    expect(
      await service.listKnowledgeBase({
        scope: 'gallery',
        limit: 50,
        offset: 0,
      }),
    ).toEqual({ items: [], hasMore: false });
    expect(list).toHaveBeenCalledWith({
      contentIds: [],
      offset: 0,
      pageSize: 51,
    });
  });

  it('does not fetch all navigation IDs for an unscoped request', async () => {
    await service.listKnowledgeBase({ limit: 50, offset: 50 });
    expect(distinct).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({
      contentIds: undefined,
      offset: 50,
      pageSize: 51,
    });
  });

  it.each([
    { limit: 0, offset: 0 },
    { limit: 1.5, offset: 0 },
    { limit: 50, offset: -1 },
    { limit: 50, offset: 0.5 },
    { limit: Number.MAX_SAFE_INTEGER, offset: 0 },
    { limit: 50, offset: Number.MAX_SAFE_INTEGER },
    { limit: 50, offset: Number.POSITIVE_INFINITY },
    { limit: 50, offset: 0, scope: 'unknown' },
  ])(
    'rejects invalid query options before database access: %j',
    async (options) => {
      await expect(service.listKnowledgeBase(options)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(list).not.toHaveBeenCalled();
      expect(distinct).not.toHaveBeenCalled();
    },
  );
});
