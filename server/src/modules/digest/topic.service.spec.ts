/**
 * TopicService 单元测试
 *
 * Mock 风格：同 info-source.service.spec.ts — 直接 new Service(mockDeps)
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TopicService } from './topic.service';
import type { ContentService } from '../content/content.service';
import type { ContentRepository } from '../content/content.repository';
import type { NavigationRepository } from '../navigation/navigation.repository';
import type { SmartTopicConfigRepository } from './smart-topic-config.repository';
import type { InfoSourceRepository } from './info-source.repository';
import type { NavigationNode } from '../navigation/navigation.entity';
import { NavigationScope } from '../navigation/navigation.entity';
import type { SmartTopicConfig } from './smart-topic-config.entity';
import { RunStatus } from './smart-topic-config.entity';
import type { ContentItem } from '../content/content-item.entity';

// ── Mock factories ────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-20T10:00:00.000Z');

function makeNavNode(overrides: Partial<NavigationNode> = {}): NavigationNode {
  return {
    _id: 'nav_id_001' as unknown as NavigationNode['_id'],
    name: 'AI 应用发展',
    scope: NavigationScope.digest,
    parentId: undefined,
    contentItemId: 'ci_aabbcc001122',
    order: 0,
    createdAt: NOW,
    updatedAt: undefined,
    ...overrides,
  } as NavigationNode;
}

function makeConfig(
  overrides: Partial<SmartTopicConfig> = {},
): SmartTopicConfig {
  return {
    _id: 'stc_aabbcc001122',
    contentItemId: 'ci_aabbcc001122',
    cron: '0 8 * * *',
    sourceIds: ['src_111', 'src_222'],
    keywords: ['AI', 'LLM'],
    prompt: '关注 AI 落地应用',
    enabled: true,
    lastRunAt: undefined,
    lastRunStatus: undefined,
    lastRunError: undefined,
    createdAt: NOW,
    updatedAt: undefined,
    ...overrides,
  };
}

function makeContentItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    _id: 'ci_aabbcc001122',
    id: 'ci_aabbcc001122',
    latestVersion: {
      versionId: 'v001',
      commitHash: '',
      title: 'AI 应用发展',
      summary: '关注 AI 在实际产品中的落地',
    },
    publishedVersion: null,
    changeLogs: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// ── Mock repositories ─────────────────────────────────────────────────────────

const mockContentService = {
  createContent: jest.fn(),
} as unknown as jest.Mocked<ContentService>;

const mockContentRepository = {
  findById: jest.fn(),
  deleteById: jest.fn(),
  patchMeta: jest.fn(),
} as unknown as jest.Mocked<ContentRepository>;

const mockNavigationRepository = {
  findRootNodes: jest.fn(),
  findByContentItemId: jest.fn(),
  findChildrenByParentId: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deleteById: jest.fn(),
} as unknown as jest.Mocked<NavigationRepository>;

const mockSmartTopicConfigRepository = {
  findByContentItemId: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deleteByContentItemId: jest.fn(),
} as unknown as jest.Mocked<SmartTopicConfigRepository>;

const mockInfoSourceRepository = {
  findManyByIds: jest.fn(),
} as unknown as jest.Mocked<InfoSourceRepository>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TopicService', () => {
  let service: TopicService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TopicService(
      mockContentService,
      mockContentRepository,
      mockNavigationRepository,
      mockSmartTopicConfigRepository,
      mockInfoSourceRepository,
    );
  });

  // Case 1: create 正常路径 — 建 ContentItem + NavNode + SmartTopicConfig，返回 DTO
  it('create() 正常路径 — 三件套均被调用，返回 TopicDetailDto', async () => {
    const contentId = 'ci_new001122334';
    mockContentService.createContent.mockResolvedValue({
      id: contentId,
      title: 'AI 应用发展',
      summary: '描述',
    } as ReturnType<ContentService['createContent']> extends Promise<infer T>
      ? T
      : never);

    mockNavigationRepository.findRootNodes.mockResolvedValue([]);
    mockNavigationRepository.create.mockResolvedValue(
      makeNavNode({ contentItemId: contentId }),
    );
    mockSmartTopicConfigRepository.create.mockResolvedValue(
      makeConfig({ contentItemId: contentId }),
    );
    mockInfoSourceRepository.findManyByIds.mockResolvedValue([
      { _id: 'src_111', name: 'Feed 1', type: 'rss' },
      { _id: 'src_222', name: 'Feed 2', type: 'rss' },
    ] as unknown as Awaited<ReturnType<InfoSourceRepository['findManyByIds']>>);

    // getById 所需 mock
    mockNavigationRepository.findByContentItemId.mockResolvedValue(
      makeNavNode({ contentItemId: contentId }),
    );
    mockContentRepository.findById.mockResolvedValue(
      makeContentItem({
        _id: contentId as unknown as ContentItem['_id'],
        id: contentId,
      }),
    );
    mockSmartTopicConfigRepository.findByContentItemId.mockResolvedValue(
      makeConfig({ contentItemId: contentId }),
    );
    mockNavigationRepository.findChildrenByParentId.mockResolvedValue([]);

    const result = await service.create({
      name: 'AI 应用发展',
      cron: '0 8 * * *',
      sourceIds: ['src_111', 'src_222'],
      keywords: ['AI', 'LLM'],
      prompt: '关注 AI 落地',
      enabled: true,
    });

    expect(mockContentService.createContent).toHaveBeenCalledWith({
      title: 'AI 应用发展',
      summary: '',
    });
    expect(mockNavigationRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: NavigationScope.digest,
        contentItemId: contentId,
      }),
    );
    const configCall = mockSmartTopicConfigRepository.create.mock.calls[0][0];
    // stc_ id 前缀
    expect(configCall._id).toMatch(/^stc_[a-f0-9]{12}$/);
    expect(result.id).toBe(contentId);
    expect(result.sourceIds).toContain('src_111');
  });

  // Case 2: create cron 格式错误 → BadRequestException
  it('create() cron 格式错误 → BadRequestException', async () => {
    await expect(
      service.create({
        name: 'test',
        cron: 'invalid-cron',
        sourceIds: [],
        keywords: [],
        prompt: 'test',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockContentService.createContent).not.toHaveBeenCalled();
  });

  // Case 3: create sourceIds 含不存在 id → BadRequestException
  it('create() sourceIds 含不存在 id → BadRequestException', async () => {
    // findManyByIds 返回空（没找到任何一个）
    mockInfoSourceRepository.findManyByIds.mockResolvedValue([]);

    await expect(
      service.create({
        name: 'test',
        cron: '0 8 * * *',
        sourceIds: ['src_nonexist'],
        keywords: [],
        prompt: 'test',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockContentService.createContent).not.toHaveBeenCalled();
  });

  // Case 4: list() 返回 entityToDto 合并多表后的 summary
  it('list() — 合并 NavNode + SmartTopicConfig，返回 TopicSummaryDto 数组', async () => {
    const navNode = makeNavNode();
    mockNavigationRepository.findRootNodes.mockResolvedValue([navNode]);
    mockSmartTopicConfigRepository.findByContentItemId.mockResolvedValue(
      makeConfig({ lastRunStatus: RunStatus.ok, lastRunAt: NOW }),
    );
    mockNavigationRepository.findChildrenByParentId.mockResolvedValue([
      makeNavNode({ _id: 'child_001' as unknown as NavigationNode['_id'] }),
    ]);

    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ci_aabbcc001122');
    expect(result[0].name).toBe('AI 应用发展');
    expect(result[0].sourceCount).toBe(2);
    expect(result[0].keywordCount).toBe(2);
    expect(result[0].reportCount).toBe(1);
    expect(result[0].lastRunStatus).toBe('ok');
    expect(result[0].lastRunHits).toBe(0); // task #36 占位
  });

  // Case 5: delete() 触发 SmartTopicConfig + NavNode + ContentItem 删除调用
  it('delete() — 调用三件套删除 + 级联子节点删除', async () => {
    const navNode = makeNavNode();
    const childNode = makeNavNode({
      _id: 'child_001' as unknown as NavigationNode['_id'],
      contentItemId: 'ci_child_001',
    });

    mockNavigationRepository.findByContentItemId.mockResolvedValue(navNode);
    mockNavigationRepository.findChildrenByParentId.mockResolvedValue([
      childNode,
    ]);
    mockContentRepository.deleteById.mockResolvedValue(undefined);
    mockNavigationRepository.deleteById.mockResolvedValue(undefined);
    mockSmartTopicConfigRepository.deleteByContentItemId.mockResolvedValue(
      undefined,
    );

    await service.delete('ci_aabbcc001122');

    // 子节点 ContentItem + NavNode 各删一次
    expect(mockContentRepository.deleteById).toHaveBeenCalledWith(
      'ci_child_001',
    );
    expect(mockNavigationRepository.deleteById).toHaveBeenCalledWith(
      'child_001',
    );

    // SmartTopicConfig 删除
    expect(
      mockSmartTopicConfigRepository.deleteByContentItemId,
    ).toHaveBeenCalledWith('ci_aabbcc001122');

    // 顶级 NavNode + ContentItem 删除
    expect(mockNavigationRepository.deleteById).toHaveBeenCalledWith(
      'nav_id_001',
    );
    expect(mockContentRepository.deleteById).toHaveBeenCalledWith(
      'ci_aabbcc001122',
    );
  });

  // Case 6: delete() 找不到 → NotFoundException
  it('delete() 找不到事项 → NotFoundException', async () => {
    mockNavigationRepository.findByContentItemId.mockResolvedValue(null);

    await expect(service.delete('ci_nonexist')).rejects.toThrow(
      NotFoundException,
    );
  });
});
