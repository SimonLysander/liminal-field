/**
 * WorkspaceController 单元测试。
 *
 * 测试重点：
 * - Controller 是纯委托层，核心断言是"正确的方法被正确地调用"。
 * - 不测试 NestJS 装饰器/路由映射（那属于 e2e 范畴），只测试业务分发逻辑。
 * - 用 jest.fn() mock 三个 service，直接 new 构造 controller，执行快、无框架依赖。
 */
import { WorkspaceController } from '../workspace.controller';
import { WorkspaceService } from '../workspace.service';
import { NoteViewService } from '../note-view.service';
import { GalleryViewService } from '../gallery-view.service';

describe('WorkspaceController', () => {
  let controller: WorkspaceController;
  let workspaceService: jest.Mocked<WorkspaceService>;
  let noteViewService: jest.Mocked<NoteViewService>;
  let galleryViewService: jest.Mocked<GalleryViewService>;

  beforeEach(() => {
    workspaceService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      publish: jest.fn(),
      unpublish: jest.fn(),
      uploadAsset: jest.fn(),
      listAssets: jest.fn(),
    } as unknown as jest.Mocked<WorkspaceService>;

    noteViewService = {
      getById: jest.fn(),
      getListItem: jest.fn(),
      saveContent: jest.fn(),
      getDraft: jest.fn(),
      saveDraft: jest.fn(),
      deleteDraft: jest.fn(),
      getHistory: jest.fn(),
      getByVersion: jest.fn(),
    } as unknown as jest.Mocked<NoteViewService>;

    galleryViewService = {
      toPostDto: jest.fn(),
      toPostDetailDto: jest.fn(),
      readPhotoBuffer: jest.fn(),
    } as unknown as jest.Mocked<GalleryViewService>;

    controller = new WorkspaceController(
      workspaceService,
      noteViewService,
      galleryViewService,
    );
  });

  // ─── list() ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('gallery scope：先用 workspaceService.list 拿 id 列表，再逐一委托 galleryViewService.toPostDto', async () => {
      // gallery 列表需要封面图和照片计数，统一走 GalleryViewService 组装
      const items = [
        { id: 'ci_gallery1', title: 'Album One' },
        { id: 'ci_gallery2', title: 'Album Two' },
      ];
      workspaceService.list.mockResolvedValue(items as never);

      const postDto1 = { id: 'ci_gallery1', title: 'Album One', photoCount: 3 };
      const postDto2 = { id: 'ci_gallery2', title: 'Album Two', photoCount: 1 };
      galleryViewService.toPostDto
        .mockResolvedValueOnce(postDto1 as never)
        .mockResolvedValueOnce(postDto2 as never);

      const mockRequest = { user: { sub: 'admin' } } as any;
      const result = await controller.list('gallery', undefined, mockRequest);

      expect(workspaceService.list).toHaveBeenCalledWith('gallery', undefined);
      expect(galleryViewService.toPostDto).toHaveBeenCalledWith('ci_gallery1');
      expect(galleryViewService.toPostDto).toHaveBeenCalledWith('ci_gallery2');
      expect(result).toEqual([postDto1, postDto2]);
    });

    it('notes scope：先用 workspaceService.list 拿 id 列表，再逐一委托 noteViewService.getListItem', async () => {
      // notes 列表需要 ContentListItemDto 格式（含 latestVersion/publishedVersion），
      // 前端组件依赖嵌套的版本结构
      const flatItems = [{ id: 'ci_note1', title: 'My Note' }];
      workspaceService.list.mockResolvedValue(flatItems as never);

      const richItem = { id: 'ci_note1', title: 'My Note', latestVersion: { commitHash: 'abc', title: 'My Note', summary: '' } };
      noteViewService.getListItem.mockResolvedValue(richItem as never);

      const mockRequest = { user: { sub: 'admin' } } as any;
      const result = await controller.list('notes', undefined, mockRequest);

      expect(workspaceService.list).toHaveBeenCalledWith('notes', undefined);
      expect(noteViewService.getListItem).toHaveBeenCalledWith('ci_note1');
      expect(galleryViewService.toPostDto).not.toHaveBeenCalled();
      expect(result).toEqual([richItem]);
    });

    it('status 过滤参数透传给 workspaceService.list', async () => {
      workspaceService.list.mockResolvedValue([]);

      const mockRequest = { user: { sub: 'admin' } } as any;
      await controller.list('notes', 'published', mockRequest);

      expect(workspaceService.list).toHaveBeenCalledWith('notes', 'published');
    });
  });

  // ─── getById() ──────────────────────────────────────────────────────────────

  describe('getById()', () => {
    it('gallery scope：委托 galleryViewService.toPostDetailDto', async () => {
      const detail = { id: 'ci_gpost', title: 'Gallery Post', photos: [] };
      galleryViewService.toPostDetailDto.mockResolvedValue(detail as never);

      const mockRequest = { user: { sub: 'admin' } } as any;
      const result = await controller.getById('gallery', 'ci_gpost', undefined, mockRequest);

      expect(galleryViewService.toPostDetailDto).toHaveBeenCalledWith('ci_gpost');
      expect(workspaceService.getById).not.toHaveBeenCalled();
      expect(result).toEqual(detail);
    });

    it('notes scope：委托 noteViewService.getById，透传 visibility 参数', async () => {
      // notes 详情需要 ContentDetailDto 格式（含 latestVersion/publishedVersion），
      // 前端 NoteReader 依赖嵌套版本结构渲染标题
      const detail = {
        id: 'ci_note',
        title: 'Note Detail',
        latestVersion: { commitHash: 'abc', title: 'Note Detail', summary: '' },
        bodyMarkdown: '# Hello',
      };
      noteViewService.getById.mockResolvedValue(detail as never);

      const mockRequest = { user: { sub: 'admin' } } as any;
      const result = await controller.getById('notes', 'ci_note', 'all', mockRequest);

      expect(noteViewService.getById).toHaveBeenCalledWith('ci_note', 'all');
      expect(workspaceService.getById).not.toHaveBeenCalled();
      expect(galleryViewService.toPostDetailDto).not.toHaveBeenCalled();
      expect(result).toEqual(detail);
    });
  });

  // ─── getDraft() ─────────────────────────────────────────────────────────────

  describe('getDraft()', () => {
    it('委托 noteViewService.getDraft', async () => {
      const draft = {
        id: 'draft_1',
        contentItemId: 'ci_note',
        title: 'Draft Title',
        bodyMarkdown: '# Draft',
        savedAt: '2026-01-01T00:00:00.000Z',
      };
      noteViewService.getDraft.mockResolvedValue(draft as never);

      const result = await controller.getDraft('ci_note');

      expect(noteViewService.getDraft).toHaveBeenCalledWith('ci_note');
      expect(result).toEqual(draft);
    });
  });

  // ─── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('委托 workspaceService.create，透传 scope 和 dto', async () => {
      const dto = { title: 'New Note', bodyMarkdown: '# Start' };
      const created = { id: 'ci_new', title: 'New Note', status: 'draft' };
      workspaceService.create.mockResolvedValue(created as never);

      const result = await controller.create('notes', dto as never);

      expect(workspaceService.create).toHaveBeenCalledWith('notes', dto);
      expect(result).toEqual(created);
    });

    it('gallery scope 也走 workspaceService.create（不区分 scope）', async () => {
      const dto = { title: 'New Album' };
      workspaceService.create.mockResolvedValue({ id: 'ci_album' } as never);

      await controller.create('gallery', dto as never);

      expect(workspaceService.create).toHaveBeenCalledWith('gallery', dto);
    });
  });

  // ─── saveNoteContent() ──────────────────────────────────────────────────────

  describe('saveNoteContent()', () => {
    it('委托 noteViewService.saveContent', async () => {
      const dto = {
        title: 'Updated Note',
        summary: 'summary',
        status: 'committed' as any,
        bodyMarkdown: '# Updated',
        changeNote: 'Updated content',
      };
      const saved = { id: 'ci_note', title: 'Updated Note' };
      noteViewService.saveContent.mockResolvedValue(saved as never);

      const result = await controller.saveNoteContent('ci_note', dto as never);

      expect(noteViewService.saveContent).toHaveBeenCalledWith('ci_note', dto);
      expect(result).toEqual(saved);
    });
  });
});
