import { NotFoundException } from '@nestjs/common';
import { NoteViewService } from '../note-view.service';
import { ContentService } from '../../content/content.service';
import { ContentRepoService } from '../../content/content-repo.service';
import { ContentGitService } from '../../content/content-git.service';
import { MinioService } from '../../minio/minio.service';
import { EditorDraftRepository } from '../editor-draft.repository';

describe('NoteViewService', () => {
  let service: NoteViewService;
  let contentService: jest.Mocked<ContentService>;
  let contentRepoService: jest.Mocked<ContentRepoService>;
  let contentGitService: jest.Mocked<ContentGitService>;
  let editorDraftRepository: jest.Mocked<EditorDraftRepository>;
  let minioService: jest.Mocked<MinioService>;

  beforeEach(() => {
    contentService = {
      saveContent: jest.fn(),
      getContentById: jest.fn(),
      getContentListItem: jest.fn(),
      assertContentItemExists: jest.fn(),
      assertContentEditable: jest.fn(),
      getContentByVersion: jest.fn(),
      prepareWritableContentWorkspace: jest.fn(),
    } as unknown as jest.Mocked<ContentService>;

    contentRepoService = {
      getContentDirectoryPath: jest.fn().mockReturnValue('/tmp/content/ci_1'),
      storeAsset: jest.fn(),
      listAssets: jest.fn(),
    } as unknown as jest.Mocked<ContentRepoService>;

    contentGitService = {
      listContentHistory: jest.fn(),
    } as unknown as jest.Mocked<ContentGitService>;

    editorDraftRepository = {
      findByContentItemId: jest.fn(),
      save: jest.fn(),
      deleteByContentItemId: jest.fn(),
    } as unknown as jest.Mocked<EditorDraftRepository>;

    minioService = {
      uploadDraftAsset: jest.fn(),
      getDraftAsset: jest.fn(),
      deleteDraftAssets: jest.fn(),
      moveDraftAssetsToDisk: jest.fn(),
    } as unknown as jest.Mocked<MinioService>;

    service = new NoteViewService(
      contentService,
      contentRepoService,
      contentGitService,
      editorDraftRepository,
      minioService,
    );
  });

  // ─── getById ───

  describe('getById()', () => {
    it('委托 contentService.getContentById，返回含 latestVersion 的完整 DTO', async () => {
      const detail = {
        id: 'ci_1',
        title: 'Note',
        latestVersion: { commitHash: 'abc', title: 'Note', summary: 'S' },
        publishedVersion: null,
        bodyMarkdown: '# Hello',
      };
      contentService.getContentById.mockResolvedValue(detail as any);

      const result = await service.getById('ci_1', 'all');

      expect(result).toBe(detail);
      expect(contentService.getContentById).toHaveBeenCalledWith(
        'ci_1',
        { visibility: 'all' },
        { scope: 'notes' },
      );
    });

    it('visibility 为 public 时传 ContentVisibility.public', async () => {
      contentService.getContentById.mockResolvedValue({} as any);

      await service.getById('ci_1', 'public');

      expect(contentService.getContentById).toHaveBeenCalledWith(
        'ci_1',
        { visibility: 'public' },
        { scope: 'notes' },
      );
    });

    it('visibility 未指定时默认 public', async () => {
      contentService.getContentById.mockResolvedValue({} as any);

      await service.getById('ci_1');

      expect(contentService.getContentById).toHaveBeenCalledWith(
        'ci_1',
        { visibility: 'public' },
        { scope: 'notes' },
      );
    });
  });

  // ─── getListItem ───

  describe('getListItem()', () => {
    it('委托 contentService.getContentListItem', async () => {
      const listItem = {
        id: 'ci_1',
        title: 'Note',
        latestVersion: { commitHash: 'abc', title: 'Note', summary: 'S' },
      };
      contentService.getContentListItem.mockResolvedValue(listItem as any);

      const result = await service.getListItem('ci_1');

      expect(result).toBe(listItem);
      expect(contentService.getContentListItem).toHaveBeenCalledWith('ci_1');
    });
  });

  // ─── saveContent ───

  describe('saveContent()', () => {
    it('委托 contentService.saveContent 进行正式保存', async () => {
      const dto = {
        title: 'T',
        summary: 'S',
        status: 'committed',
        bodyMarkdown: 'B',
        changeNote: 'N',
      } as any;
      const expected = { id: 'ci_1' };
      minioService.moveDraftAssetsToDisk.mockResolvedValue([]);
      contentService.saveContent.mockResolvedValue(expected as any);

      const result = await service.saveContent('ci_1', dto);

      expect(result).toBe(expected);
      expect(contentService.saveContent).toHaveBeenCalledWith('ci_1', dto);
    });
  });

  // ─── getDraft ───

  describe('getDraft()', () => {
    const mockDraft = {
      _id: 'draft:ci_1',
      contentItemId: 'ci_1',
      title: 'Draft Title',
      summary: 'Draft Summary',
      bodyMarkdown: '# Draft',
      changeNote: 'autosave',
      savedAt: new Date('2026-01-01'),
      savedBy: 'user1',
    };

    it('先确认 contentItem 存在，再返回草稿 DTO', async () => {
      editorDraftRepository.findByContentItemId.mockResolvedValue(mockDraft);

      const result = await service.getDraft('ci_1');

      expect(contentService.assertContentItemExists).toHaveBeenCalledWith(
        'ci_1',
      );
      expect(result).toEqual({
        id: 'draft:ci_1',
        contentItemId: 'ci_1',
        title: 'Draft Title',
        summary: 'Draft Summary',
        bodyMarkdown: '# Draft',
        changeNote: 'autosave',
        savedAt: '2026-01-01T00:00:00.000Z',
        savedBy: 'user1',
      });
    });

    it('contentItem 存在但无草稿时返回 null', async () => {
      editorDraftRepository.findByContentItemId.mockResolvedValue(null);

      const result = await service.getDraft('ci_1');
      expect(result).toBeNull();
    });

    it('contentItem 不存在时由 assertContentItemExists 抛出', async () => {
      contentService.assertContentItemExists.mockRejectedValue(
        new NotFoundException('Content ci_999 not found'),
      );

      await expect(service.getDraft('ci_999')).rejects.toThrow(
        NotFoundException,
      );
      // assertContentItemExists 在 findByContentItemId 之前调用
      expect(editorDraftRepository.findByContentItemId).not.toHaveBeenCalled();
    });
  });

  // ─── saveDraft ───

  describe('saveDraft()', () => {
    it('先确认可编辑，再 upsert 草稿并返回 DTO', async () => {
      const dto = {
        title: 'T',
        summary: 'S',
        bodyMarkdown: 'B',
        changeNote: 'N',
        savedBy: 'user1',
      };
      const saved = {
        _id: 'draft:ci_1',
        contentItemId: 'ci_1',
        ...dto,
        savedAt: new Date('2026-01-01'),
      };
      editorDraftRepository.save.mockResolvedValue(saved);

      const result = await service.saveDraft('ci_1', dto);

      expect(contentService.assertContentEditable).toHaveBeenCalledWith('ci_1');
      expect(editorDraftRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ contentItemId: 'ci_1', title: 'T' }),
      );
      expect(result.id).toBe('draft:ci_1');
    });
  });

  // ─── deleteDraft ───

  describe('deleteDraft()', () => {
    it('先确认 contentItem 存在，再删除草稿', async () => {
      await service.deleteDraft('ci_1');

      expect(contentService.assertContentItemExists).toHaveBeenCalledWith(
        'ci_1',
      );
      expect(editorDraftRepository.deleteByContentItemId).toHaveBeenCalledWith(
        'ci_1',
      );
    });
  });

  // ─── getHistory ───

  describe('getHistory()', () => {
    it('确认 contentItem 存在后委托 contentGitService', async () => {
      const history = [{ commitHash: 'abc', message: 'init' }];
      contentGitService.listContentHistory.mockResolvedValue(history as any);

      const result = await service.getHistory('ci_1');

      expect(contentService.assertContentItemExists).toHaveBeenCalledWith(
        'ci_1',
      );
      expect(result).toBe(history);
    });
  });

  // ─── getByVersion ───

  describe('getByVersion()', () => {
    it('委托 contentService.getContentByVersion', async () => {
      const detail = { id: 'ci_1', title: 'v1' };
      contentService.getContentByVersion.mockResolvedValue(detail as any);

      const result = await service.getByVersion('ci_1', 'abc123');

      expect(result).toBe(detail);
      expect(contentService.getContentByVersion).toHaveBeenCalledWith(
        'ci_1',
        'abc123',
        { scope: 'notes' },
      );
    });
  });

  // ─── uploadAsset ───

  describe('uploadAsset()', () => {
    it('确认可编辑 + 切换工作分支后存储附件', async () => {
      contentRepoService.storeAsset.mockResolvedValue({
        path: 'content/ci_1/assets/img.png',
        fileName: 'img.png',
      });

      const result = await service.uploadAsset('ci_1', {
        originalFileName: 'img.png',
        contentType: 'image/png',
        buffer: Buffer.from('fake'),
      });

      expect(contentService.assertContentEditable).toHaveBeenCalledWith('ci_1');
      expect(contentService.prepareWritableContentWorkspace).toHaveBeenCalled();
      expect(result).toEqual({
        path: 'content/ci_1/assets/img.png',
        fileName: 'img.png',
        contentType: 'image/png',
        size: 4,
      });
    });
  });

  // ─── listAssets ───

  describe('listAssets()', () => {
    it('确认 contentItem 存在后列出附件', async () => {
      const assets = [{ fileName: 'a.png', type: 'image', size: 100 }];
      contentRepoService.listAssets.mockResolvedValue(assets as any);

      const result = await service.listAssets('ci_1');

      expect(contentService.assertContentItemExists).toHaveBeenCalledWith(
        'ci_1',
      );
      expect(result).toBe(assets);
    });
  });
});
