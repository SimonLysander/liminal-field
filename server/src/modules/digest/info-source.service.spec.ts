/**
 * InfoSourceService 单元测试
 *
 * Mock 风格：同 note-view.service.test.ts:38-49，直接 new Service(mockRepo)
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InfoSourceService } from './info-source.service';
import { InfoSourceRepository } from './info-source.repository';
import { InfoSourceType, FetchStatus } from './info-source.entity';
import type { InfoSource } from './info-source.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';
import type { SmartTopicConfig } from './smart-topic-config.entity';

// ── Mock repository ───────────────────────────────────────────────
const mockRepo = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deleteById: jest.fn(),
} as unknown as jest.Mocked<InfoSourceRepository>;

const mockSmartTopicConfigRepo = {
  findAll: jest.fn(),
} as unknown as jest.Mocked<SmartTopicConfigRepository>;

// ── Fixture ───────────────────────────────────────────────────────
const NOW = new Date('2026-06-20T10:00:00.000Z');

function makeEntity(overrides: Partial<InfoSource> = {}): InfoSource {
  return {
    _id: 'src_aabbcc001122',
    type: InfoSourceType.rss,
    name: 'Test Feed',
    config: { url: 'https://example.com/feed.xml' },
    enabled: true,
    lastFetchedAt: undefined,
    lastFetchStatus: undefined,
    lastFetchError: undefined,
    createdAt: NOW,
    updatedAt: undefined,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────
describe('InfoSourceService', () => {
  let service: InfoSourceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InfoSourceService(mockRepo, mockSmartTopicConfigRepo);
  });

  // Case 1：list() 调 repository.findAll，结果经 entityToDto 转换（Date → ISO string）
  it('list() — 返回 entityToDto 转换后的 DTO 数组，Date 变 ISO string', async () => {
    const entity = makeEntity({
      lastFetchedAt: NOW,
      lastFetchStatus: FetchStatus.ok,
    });
    mockRepo.findAll.mockResolvedValue([entity]);

    const result = await service.list();

    expect(mockRepo.findAll).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('src_aabbcc001122');
    expect(result[0].createdAt).toBe(NOW.toISOString());
    expect(result[0].lastFetchedAt).toBe(NOW.toISOString());
    expect(result[0].updatedAt).toBeNull();
    expect(result[0].lastFetchError).toBeNull();
  });

  // Case 2：create() rss 正常路径 — 调 repository.create，id 前缀 src_，返回 DTO
  it('create() rss 正常路径 — id 前缀 src_，调 repo.create，返回 DTO', async () => {
    const entity = makeEntity();
    mockRepo.create.mockResolvedValue(entity);

    const result = await service.create({
      type: InfoSourceType.rss,
      name: 'Test Feed',
      config: { url: 'https://example.com/feed.xml' },
    });

    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    const call = mockRepo.create.mock.calls[0][0];
    // 业务 id 必须 src_ 开头
    expect(call._id).toMatch(/^src_[a-f0-9]{12}$/);
    expect(result.type).toBe('rss');
    expect(result.name).toBe('Test Feed');
  });

  // Case 3：create() type=rss 但 config 无 url → BadRequestException
  it('create() rss 但 config 缺 url → BadRequestException', async () => {
    await expect(
      service.create({
        type: InfoSourceType.rss,
        name: 'Bad Feed',
        config: {},
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  // Case 4：create() type=webpage（任意非 rss）→ BadRequestException
  it('create() type=webpage → BadRequestException（暂不支持）', async () => {
    await expect(
      service.create({
        type: InfoSourceType.webpage,
        name: 'Web Monitor',
        config: { url: 'https://example.com' },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  // Case 5：delete() 调 repository.deleteById，await 完成不抛错
  it('delete() — 调 repo.deleteById，不抛错', async () => {
    mockSmartTopicConfigRepo.findAll.mockResolvedValue([]);
    mockRepo.deleteById.mockResolvedValue(undefined);

    await expect(service.delete('src_aabbcc001122')).resolves.toBeUndefined();
    expect(mockRepo.deleteById).toHaveBeenCalledWith('src_aabbcc001122');
  });

  // Case 6 (task #35)：delete() 有 SmartTopicConfig 订阅 → BadRequestException
  it('delete() 有事项订阅该信息源 → BadRequestException，不调 deleteById', async () => {
    const sourceId = 'src_aabbcc001122';
    mockSmartTopicConfigRepo.findAll.mockResolvedValue([
      { _id: 'stc_001', contentItemId: 'ci_001', sourceIds: [sourceId] },
      {
        _id: 'stc_002',
        contentItemId: 'ci_002',
        sourceIds: ['src_other', sourceId],
      },
    ] as unknown as SmartTopicConfig[]);

    await expect(service.delete(sourceId)).rejects.toThrow(BadRequestException);
    await expect(service.delete(sourceId)).rejects.toThrow('2 个事项订阅');
    expect(mockRepo.deleteById).not.toHaveBeenCalled();
  });

  // 额外：getById 找不到时 NotFoundException
  it('getById() 找不到 → NotFoundException', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(service.getById('src_nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });
});
