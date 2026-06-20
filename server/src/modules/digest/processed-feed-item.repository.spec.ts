/**
 * ProcessedFeedItemRepository 单元测试
 *
 * Mock 风格：同 info-source.service.spec.ts — 直接 mock model，不启 NestJS DI。
 * 测试覆盖：
 *   1. existsByTopicAndGuid() 已存在 → true
 *   2. existsByTopicAndGuid() 不存在 → false
 *   3. findRecentByTopic() 返回按 pickedAt 倒序的文档
 *   4. create() 写入后返回文档
 */
import { ProcessedFeedItemRepository } from './processed-feed-item.repository';
import type { ProcessedFeedItem } from './processed-feed-item.entity';

// ── Mock Model ────────────────────────────────────────────────────────────────

const mockModel = {
  countDocuments: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
} as unknown as jest.Mocked<any>;

// 支持链式 .exec()
function chainExec<T>(val: T) {
  return { exec: jest.fn().mockResolvedValue(val) };
}

// ── Fixture ────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-20T10:00:00.000Z');
const YESTERDAY = new Date('2026-06-19T10:00:00.000Z');

function makePfi(
  overrides: Partial<ProcessedFeedItem> = {},
): ProcessedFeedItem {
  return {
    _id: 'pfi_aabbcc001122',
    topicId: 'ci_topic001',
    sourceId: 'src_src001',
    itemGuid: 'guid-001',
    title: 'Test Article',
    url: 'https://example.com/1',
    pickedAt: NOW,
    reportContentItemId: 'ci_report001',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ProcessedFeedItemRepository', () => {
  let repo: ProcessedFeedItemRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    // 注入 mock model（替代 @Inject(getModelToken(...))）
    repo = new ProcessedFeedItemRepository(mockModel);
  });

  // Case 1: existsByTopicAndGuid — 已存在 → true
  it('existsByTopicAndGuid() — count=1 → true', async () => {
    mockModel.countDocuments.mockReturnValue(chainExec(1));

    const result = await repo.existsByTopicAndGuid('ci_topic001', 'guid-001');

    expect(mockModel.countDocuments).toHaveBeenCalledWith({
      topicId: 'ci_topic001',
      itemGuid: 'guid-001',
    });
    expect(result).toBe(true);
  });

  // Case 2: existsByTopicAndGuid — 不存在 → false
  it('existsByTopicAndGuid() — count=0 → false', async () => {
    mockModel.countDocuments.mockReturnValue(chainExec(0));

    const result = await repo.existsByTopicAndGuid(
      'ci_topic001',
      'guid-nonexist',
    );

    expect(result).toBe(false);
  });

  // Case 3: findRecentByTopic — 返回文档列表（链式 sort）
  it('findRecentByTopic() — 返回事项最近条目', async () => {
    const docs = [
      makePfi({ pickedAt: NOW }),
      makePfi({ _id: 'pfi_222', itemGuid: 'guid-002', pickedAt: YESTERDAY }),
    ];
    const sortMock = { exec: jest.fn().mockResolvedValue(docs) };
    const findMock = { sort: jest.fn().mockReturnValue(sortMock) };
    mockModel.find.mockReturnValue(findMock);

    const result = await repo.findRecentByTopic('ci_topic001', 7);

    expect(mockModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: 'ci_topic001' }),
    );
    expect(findMock.sort).toHaveBeenCalledWith({ pickedAt: -1 });
    expect(result).toHaveLength(2);
    expect(result[0]._id).toBe('pfi_aabbcc001122');
  });

  // Case 4: create() — 写入后返回文档
  it('create() — 调 model.create 返回 ProcessedFeedItem', async () => {
    const doc = makePfi();
    mockModel.create.mockResolvedValue(doc);

    const result = await repo.create({
      _id: 'pfi_aabbcc001122',
      topicId: 'ci_topic001',
      sourceId: 'src_src001',
      itemGuid: 'guid-001',
      title: 'Test Article',
      url: 'https://example.com/1',
      pickedAt: NOW,
      reportContentItemId: 'ci_report001',
    });

    expect(mockModel.create).toHaveBeenCalledTimes(1);
    expect(result._id).toBe('pfi_aabbcc001122');
    expect(result.topicId).toBe('ci_topic001');
  });
});
