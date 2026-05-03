/**
 * WorkspaceService 单元测试。
 *
 * 测试策略：
 * - 所有外部依赖均用 jest.fn() 手动 mock，不启动 NestJS 容器，执行快。
 * - 每个用例只断言一个行为点，避免用例之间产生耦合。
 * - NavigationNode / ContentItem 的 mock 数据用工厂函数生成，保持测试数据易读。
 */
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { WorkspaceService } from '../workspace.service';
import { ContentService } from '../../content/content.service';
import { ContentRepository } from '../../content/content.repository';
import { ContentRepoService } from '../../content/content-repo.service';
import { NavigationRepository } from '../../navigation/navigation.repository';
import { NavigationNodeType } from '../../navigation/navigation.entity';
import { ContentStatus } from '../../content/content-item.entity';
import { ContentSaveAction } from '../../content/dto/save-content.dto';

// ─── 工厂函数：生成测试用 NavigationNode ───────────────────────────────────────

function createNavNode(overrides: {
  id?: string;
  name?: string;
  scope?: string;
  nodeType?: NavigationNodeType;
  contentItemId?: string;
  order?: number;
}) {
  return {
    _id: new Types.ObjectId(overrides.id),
    name: overrides.name ?? 'Test Item',
    scope: overrides.scope ?? 'notes',
    nodeType: overrides.nodeType ?? NavigationNodeType.content,
    contentItemId: overrides.contentItemId,
    order: overrides.order ?? 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: null,
  };
}

// ─── 工厂函数：生成测试用 ContentItem ─────────────────────────────────────────

function createContentItem(overrides: {
  id?: string;
  title?: string;
  summary?: string;
  published?: boolean;
}) {
  const id = overrides.id ?? 'ci_abc123';
  const latestVersion = {
    commitHash: 'abc123',
    title: overrides.title ?? 'Test Title',
    summary: overrides.summary ?? 'Test Summary',
  };
  return {
    _id: id,
    id,
    latestVersion,
    publishedVersion: overrides.published ? latestVersion : null,
    changeLogs: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

// ─── 测试套件 ─────────────────────────────────────────────────────────────────

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let contentService: jest.Mocked<ContentService>;
  let contentRepository: jest.Mocked<ContentRepository>;
  let contentRepoService: jest.Mocked<ContentRepoService>;
  let navigationRepository: jest.Mocked<NavigationRepository>;

  beforeEach(() => {
    contentService = {
      createContent: jest.fn(),
      saveContent: jest.fn(),
      assertContentItemExists: jest.fn(),
      prepareWritableContentWorkspace: jest.fn(),
    } as unknown as jest.Mocked<ContentService>;

    contentRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ContentRepository>;

    contentRepoService = {
      readContentSource: jest.fn(),
      storeAsset: jest.fn(),
      listAssets: jest.fn(),
    } as unknown as jest.Mocked<ContentRepoService>;

    navigationRepository = {
      findRootNodes: jest.fn(),
      create: jest.fn(),
      findByContentItemId: jest.fn(),
      deleteById: jest.fn(),
    } as unknown as jest.Mocked<NavigationRepository>;

    service = new WorkspaceService(
      contentService,
      contentRepository,
      contentRepoService,
      navigationRepository,
    );
  });

  // ─── create() ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('调用 contentService.createContent 并在 Navigation 中注册 scope 正确的索引', async () => {
      const contentItemId = 'ci_newitem';
      const createdDetail = {
        id: contentItemId,
        title: 'My New Note',
        summary: 'My New Note',
        status: 'draft' as const,
        bodyMarkdown: '',
        plainText: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      // createContent 返回含 id 的 detail DTO
      contentService.createContent.mockResolvedValue(createdDetail as never);

      // findRootNodes 返回空（新 scope 无兄弟节点）
      navigationRepository.findRootNodes.mockResolvedValue([]);
      navigationRepository.create.mockResolvedValue({} as never);

      // getById 内部会再调 contentRepository 和 contentRepoService
      const contentItem = createContentItem({ id: contentItemId, title: 'My New Note' });
      contentRepository.findById.mockResolvedValue(contentItem as never);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'body',
        plainText: 'body',
      } as never);

      await service.create('notes', { title: 'My New Note' });

      // 验证 createContent 被调用，且 title 正确
      expect(contentService.createContent).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'My New Note' }),
      );

      // 验证 Navigation 索引的 scope 与传入参数一致
      expect(navigationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'notes',
          contentItemId,
          nodeType: NavigationNodeType.content,
        }),
      );
    });

    it('新节点的 order 等于当前 scope 下兄弟节点数量', async () => {
      const siblings = [
        createNavNode({ contentItemId: 'ci_a' }),
        createNavNode({ contentItemId: 'ci_b' }),
      ];
      // 已有 2 个兄弟，新节点 order 应为 2
      navigationRepository.findRootNodes.mockResolvedValue(siblings as never);

      const contentItemId = 'ci_new';
      contentService.createContent.mockResolvedValue({ id: contentItemId } as never);
      navigationRepository.create.mockResolvedValue({} as never);

      const contentItem = createContentItem({ id: contentItemId });
      contentRepository.findById.mockResolvedValue(contentItem as never);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: '',
        plainText: '',
      } as never);

      await service.create('gallery', { title: 'New Gallery Post' });

      expect(navigationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ order: 2 }),
      );
    });
  });

  // ─── list() ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('按 scope 查询 Navigation 并返回对应条目', async () => {
      const contentItemId = 'ci_listed';
      const nodes = [
        createNavNode({ nodeType: NavigationNodeType.content, contentItemId, scope: 'notes' }),
      ];
      navigationRepository.findRootNodes.mockResolvedValue(nodes as never);

      const contentItem = createContentItem({ id: contentItemId, title: 'Listed Note' });
      contentRepository.findById.mockResolvedValue(contentItem as never);

      const result = await service.list('notes');

      // findRootNodes 必须以 scope='notes' 调用
      expect(navigationRepository.findRootNodes).toHaveBeenCalledWith('notes');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(contentItemId);
    });

    it('subject 类型节点（无 contentItemId）不出现在结果列表中', async () => {
      // subject 节点是目录文件夹，没有对应的 content item
      const nodes = [
        createNavNode({ nodeType: NavigationNodeType.subject }),
      ];
      navigationRepository.findRootNodes.mockResolvedValue(nodes as never);

      const result = await service.list('notes');

      expect(result).toHaveLength(0);
      // 无 contentItemId 的节点不会触发 contentRepository 查询
      expect(contentRepository.findById).not.toHaveBeenCalled();
    });

    it('按 status 过滤：只返回已发布的条目', async () => {
      const draftId = 'ci_draft';
      const publishedId = 'ci_published';
      const nodes = [
        createNavNode({ nodeType: NavigationNodeType.content, contentItemId: draftId }),
        createNavNode({ nodeType: NavigationNodeType.content, contentItemId: publishedId }),
      ];
      navigationRepository.findRootNodes.mockResolvedValue(nodes as never);

      const draftItem = createContentItem({ id: draftId, published: false });
      const publishedItem = createContentItem({ id: publishedId, published: true });

      contentRepository.findById.mockImplementation((id: string) => {
        if (id === draftId) return Promise.resolve(draftItem as never);
        if (id === publishedId) return Promise.resolve(publishedItem as never);
        return Promise.resolve(null);
      });

      const result = await service.list('notes', 'published');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(publishedId);
    });
  });

  // ─── getById() ──────────────────────────────────────────────────────────────

  describe('getById()', () => {
    it('从 contentRepository 读取元数据，从 contentRepoService 读取 Markdown 正文', async () => {
      const contentItemId = 'ci_detail';
      const contentItem = createContentItem({ id: contentItemId, title: 'Detail Note' });
      contentRepository.findById.mockResolvedValue(contentItem as never);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'Hello World',
        plainText: 'Hello World',
      } as never);

      const result = await service.getById('notes', contentItemId);

      expect(contentRepository.findById).toHaveBeenCalledWith(contentItemId);
      expect(contentRepoService.readContentSource).toHaveBeenCalledWith(contentItemId, { scope: 'notes' });
      expect(result.title).toBe('Detail Note');
      expect(result.bodyMarkdown).toBe('Hello World');
    });

    it('content item 不存在时抛出 NotFoundException', async () => {
      contentRepository.findById.mockResolvedValue(null);

      await expect(service.getById('notes', 'ci_missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('零宽占位符在 getById 返回时还原为空字符串', async () => {
      // EMPTY_BODY_PLACEHOLDER = '\u200B'，画廊动态允许无描述，用占位符通过非空校验
      const contentItem = createContentItem({ id: 'ci_empty' });
      contentRepository.findById.mockResolvedValue(contentItem as never);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: '\u200B',
        plainText: '',
      } as never);

      const result = await service.getById('gallery', 'ci_empty');

      expect(result.bodyMarkdown).toBe('');
    });
  });

  // ─── remove() ───────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('通过 contentItemId 找到 Navigation 节点后删除', async () => {
      const navNode = createNavNode({
        id: new Types.ObjectId().toHexString(),
        contentItemId: 'ci_to_remove',
      });
      navigationRepository.findByContentItemId.mockResolvedValue(navNode as never);
      navigationRepository.deleteById.mockResolvedValue(undefined);

      await service.remove('notes', 'ci_to_remove');

      expect(navigationRepository.findByContentItemId).toHaveBeenCalledWith('ci_to_remove');
      expect(navigationRepository.deleteById).toHaveBeenCalledWith(navNode._id.toString());
    });

    it('Navigation 节点不存在时 remove() 静默成功（幂等）', async () => {
      // 允许重复调用不报错，保证接口幂等性
      navigationRepository.findByContentItemId.mockResolvedValue(null);

      await expect(service.remove('notes', 'ci_ghost')).resolves.toBeUndefined();
      expect(navigationRepository.deleteById).not.toHaveBeenCalled();
    });
  });

  // ─── publish() ──────────────────────────────────────────────────────────────

  describe('publish()', () => {
    it('以 publish action 调用 contentService.saveContent', async () => {
      const contentItemId = 'ci_to_publish';
      const contentItem = createContentItem({ id: contentItemId, published: false });
      contentRepository.findById.mockResolvedValue(contentItem as never);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'Some content',
        plainText: 'Some content',
      } as never);
      contentService.saveContent.mockResolvedValue({} as never);

      await service.publish('notes', contentItemId);

      // 关键断言：action 必须是 publish
      expect(contentService.saveContent).toHaveBeenCalledWith(
        contentItemId,
        expect.objectContaining({ action: ContentSaveAction.publish }),
      );
    });

    it('content item 不存在时 publish() 抛出 NotFoundException', async () => {
      contentRepository.findById.mockResolvedValue(null);

      await expect(service.publish('notes', 'ci_missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ─── unpublish() ────────────────────────────────────────────────────────────

  describe('unpublish()', () => {
    it('以 unpublish action 调用 contentService.saveContent', async () => {
      const contentItemId = 'ci_to_unpublish';
      // 已发布状态
      const contentItem = createContentItem({ id: contentItemId, published: true });
      contentRepository.findById.mockResolvedValue(contentItem as never);
      contentRepoService.readContentSource.mockResolvedValue({
        bodyMarkdown: 'Body',
        plainText: 'Body',
      } as never);
      contentService.saveContent.mockResolvedValue({} as never);

      await service.unpublish('notes', contentItemId);

      // unpublish 时传入的 status 是 published（当前状态），action 是 unpublish（期望操作）
      expect(contentService.saveContent).toHaveBeenCalledWith(
        contentItemId,
        expect.objectContaining({
          status: ContentStatus.published,
          action: ContentSaveAction.unpublish,
        }),
      );
    });
  });
});
