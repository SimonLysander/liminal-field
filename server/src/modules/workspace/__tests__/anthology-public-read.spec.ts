import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ContentItem } from '../../content/content-item.entity';
import { ContentRepository } from '../../content/content.repository';
import { ContentSnapshot } from '../../content/content-snapshot.entity';
import { ContentSnapshotRepository } from '../../content/content-snapshot.repository';
import { ContentService } from '../../content/content.service';
import {
  NavigationNode,
  NavigationScope,
} from '../../navigation/navigation.entity';
import { NavigationRepository } from '../../navigation/navigation.repository';
import { AnthologyViewService } from '../anthology-view.service';
import { EditorDraftRepository } from '../editor-draft.repository';

describe('Anthology public version isolation', () => {
  const publishedAt = new Date('2026-04-01T00:00:00.000Z');
  const editedAt = new Date('2026-05-01T00:00:00.000Z');
  let service: AnthologyViewService;
  let items: Map<string, ContentItem>;
  let snapshots: Map<string, ContentSnapshot>;
  let root: NavigationNode;
  let children: NavigationNode[];
  const findByVersionId = jest.fn<Promise<ContentSnapshot | null>, [string]>();
  const getLatestSnapshot = jest.fn<
    Promise<ContentSnapshot | null>,
    [string]
  >();

  beforeEach(async () => {
    findByVersionId.mockReset();
    getLatestSnapshot.mockReset();
    root = Object.assign(new NavigationNode(), {
      _id: new Types.ObjectId(),
      contentItemId: 'ci_collection',
      scope: NavigationScope.anthology,
    });
    children = ['ci_first', 'ci_second', 'ci_private'].map((contentItemId) =>
      Object.assign(new NavigationNode(), {
        _id: new Types.ObjectId(),
        parentId: root._id,
        contentItemId,
        name: `Unpublished navigation ${contentItemId}`,
        scope: NavigationScope.anthology,
      }),
    );
    items = new Map();
    snapshots = new Map();
    for (const id of [
      root.contentItemId,
      ...children.map((node) => node.contentItemId),
    ]) {
      const publishedVersion =
        id === 'ci_private'
          ? null
          : {
              versionId: `${id}_published`,
              commitHash: '',
              title: `Published ${id}`,
              summary: 'Published summary',
            };
      const latestVersion = {
        versionId: `${id}_latest`,
        commitHash: '',
        title: `Unpublished ${id}`,
        summary: 'Unpublished summary',
      };
      items.set(
        id,
        Object.assign(new ContentItem(), {
          _id: id,
          latestVersion,
          publishedVersion,
          changeLogs: [],
          createdAt: publishedAt,
          updatedAt: editedAt,
        }),
      );
      for (const version of [publishedVersion, latestVersion]) {
        if (!version) continue;
        const isPublished = version === publishedVersion;
        snapshots.set(
          version.versionId,
          Object.assign(new ContentSnapshot(), {
            _id: version.versionId,
            contentItemId: id,
            fileName: null,
            title: version.title,
            summary: version.summary,
            createdAt: isPublished ? publishedAt : editedAt,
            bodyMarkdown:
              id === root.contentItemId
                ? `---\ntitle: "${version.title}"\ndescription: "${version.summary}"\n---\n${version.title} body`
                : `---\ndate: ${isPublished ? '2026-04-01' : '2026-05-01'}\n---\n${version.title} body`,
          }),
        );
      }
    }
    findByVersionId.mockImplementation((id) =>
      Promise.resolve(snapshots.get(id) ?? null),
    );
    getLatestSnapshot.mockImplementation((id) =>
      Promise.resolve(snapshots.get(`${id}_latest`) ?? null),
    );
    const module = await Test.createTestingModule({
      providers: [
        AnthologyViewService,
        {
          provide: ContentRepository,
          useValue: {
            findById: jest.fn((id: string) =>
              Promise.resolve(items.get(id) ?? null),
            ),
          },
        },
        { provide: ContentService, useValue: { getLatestSnapshot } },
        { provide: ContentSnapshotRepository, useValue: { findByVersionId } },
        { provide: EditorDraftRepository, useValue: {} },
        {
          provide: NavigationRepository,
          useValue: {
            findByContentItemId: jest.fn((id: string) =>
              Promise.resolve(
                id === root.contentItemId
                  ? root
                  : (children.find((node) => node.contentItemId === id) ??
                      null),
              ),
            ),
            findChildrenByParentId: jest.fn(() => Promise.resolve(children)),
          },
        },
      ],
    }).compile();
    service = module.get(AnthologyViewService);
  });

  it('uses published titles and dates in the public directory without reading latest snapshots', async () => {
    const result = await service.toPublicDetail(root.contentItemId);
    expect(result.entries).toEqual([
      { nodeId: 'ci_first', title: 'Published ci_first', date: '2026-04-01' },
      { nodeId: 'ci_second', title: 'Published ci_second', date: '2026-04-01' },
    ]);
    expect(result.bodyMarkdown).toBe('Published ci_collection body');
    expect(getLatestSnapshot).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('Unpublished');
  });

  it('uses the published title, date, update time and sibling title when reading an entry', async () => {
    const result = await service.getEntryDetail(
      root.contentItemId,
      'ci_first',
      true,
    );
    expect(result).toMatchObject({
      title: 'Published ci_first',
      date: '2026-04-01',
      updatedAt: publishedAt.toISOString(),
      bodyMarkdown: 'Published ci_first body',
      prev: null,
      next: { nodeId: 'ci_second', title: 'Published ci_second' },
    });
    expect(getLatestSnapshot).not.toHaveBeenCalled();
  });

  it('keeps the newest committed content and unpublished siblings in the admin view', async () => {
    const result = await service.getEntryDetail(
      root.contentItemId,
      'ci_second',
      false,
    );
    expect(result).toMatchObject({
      title: 'Unpublished ci_second',
      date: '2026-05-01',
      updatedAt: editedAt.toISOString(),
      bodyMarkdown: 'Unpublished ci_second body',
      prev: { nodeId: 'ci_first', title: 'Unpublished ci_first' },
      next: { nodeId: 'ci_private', title: 'Unpublished ci_private' },
    });
  });

  it('uses the published container update time in the public list', async () => {
    expect(await service.toPublicListItem(root.contentItemId)).toMatchObject({
      updatedAt: publishedAt.toISOString(),
    });
  });

  it('does not expose an unpublished entry', async () => {
    await expect(
      service.getEntryDetail(root.contentItemId, 'ci_private', true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not fall back to the latest snapshot when the published directory snapshot is missing', async () => {
    snapshots.delete('ci_first_published');
    await expect(
      service.toPublicDetail(root.contentItemId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(getLatestSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a published pointer to another content item', async () => {
    const snapshot = snapshots.get('ci_first_published');
    if (!snapshot) throw new Error('Missing test fixture');
    snapshot.contentItemId = 'ci_private';
    await expect(
      service.getEntryDetail(root.contentItemId, 'ci_first', true),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
