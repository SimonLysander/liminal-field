/**
 * InfoSourceService.onModuleInit 单元测试（seed + migrate 逻辑）。
 *
 * Mock 风格：直接 mock mongoose model（与 info-source.service.spec.ts 保持一致）。
 * 三个 case 覆盖 onModuleInit 的三个阶段：
 *   1a. migrate：老数据缺 category → 批量补 'engineering'
 *   1b. migrate：数据库残留旧 enum 值（tech/china_tech/reading/academic）→ map 到新 5 类
 *   2. seed 首次：DB 空 → SEED_SOURCES 全部插入，category 字段正确
 *   3. seed 幂等：已 seed 过 → 再次调用不重复插入（count 不变）
 */
import { InfoSourceService } from './info-source.service';
import { InfoSourceRepository } from './info-source.repository';
import { InfoSourceCategory } from './info-source.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';
import { SEED_SOURCES } from './source-seeds';

// ── Mock repository（onModuleInit 不走 repo，但构造函数必须传） ──────────────
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

// ── Model mock builder（每个 case 独立配置） ─────────────────────────────────

function buildModelMock(opts: {
  /** updateMany 返回的 modifiedCount（Step 1a 补默认值用） */
  modifiedCount?: number;
  /** countDocuments 返回值（控制 seed 是否跳过） */
  countDocumentsResult?: number;
  /** Step 1b oldToNew map 各条的 modifiedCount（全部 mock 为 0 即旧值不存在） */
  oldToNewModifiedCount?: number;
}) {
  const {
    modifiedCount = 0,
    countDocumentsResult = 0,
    oldToNewModifiedCount = 0,
  } = opts;
  // updateMany 按调用顺序返回：第 1 次(Step 1a)→ modifiedCount，后续(Step 1b x4)→ oldToNewModifiedCount
  let callCount = 0;
  return {
    updateMany: jest.fn().mockImplementation(() => ({
      exec: jest.fn().mockResolvedValue({
        modifiedCount:
          callCount++ === 0 ? modifiedCount : oldToNewModifiedCount,
      }),
    })),
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(countDocumentsResult),
    }),
    create: jest.fn().mockResolvedValue({}),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InfoSourceService.onModuleInit', () => {
  // Case 1：migrate Step 1a — 老数据缺 category 字段 → 批量补 'engineering'
  it('migrate Step 1a：updateMany 收到 { category: { $exists: false } } → { $set: { category: engineering } }', async () => {
    const model = buildModelMock({
      modifiedCount: 3,
      countDocumentsResult: 1 /* 全部 seed 已存在，跳过 */,
    });
    const service = new InfoSourceService(
      mockRepo,
      mockSmartTopicConfigRepo,
      model as unknown as jest.Mocked<any>,
    );

    await service.onModuleInit();

    // 第一次调用是 Step 1a（补缺字段）
    expect(model.updateMany).toHaveBeenNthCalledWith(
      1,
      { category: { $exists: false } },
      { $set: { category: InfoSourceCategory.engineering } },
    );
    // Step 1b：4 个旧 enum 值 map 调用
    expect(model.updateMany).toHaveBeenCalledWith(
      { category: 'tech' },
      { $set: { category: InfoSourceCategory.engineering } },
    );
    expect(model.updateMany).toHaveBeenCalledWith(
      { category: 'china_tech' },
      { $set: { category: InfoSourceCategory.engineering } },
    );
    expect(model.updateMany).toHaveBeenCalledWith(
      { category: 'reading' },
      { $set: { category: InfoSourceCategory.longform } },
    );
    expect(model.updateMany).toHaveBeenCalledWith(
      { category: 'academic' },
      { $set: { category: InfoSourceCategory.ai } },
    );
    // 没有新 seed 时 create 不应被调用
    expect(model.create).not.toHaveBeenCalled();
  });

  // Case 2：seed 首次 — countDocuments 全返回 0 → SEED_SOURCES 全部插入
  it('seed 首次：DB 空时所有 SEED_SOURCES 均被 create，category 字段正确', async () => {
    const model = buildModelMock({ modifiedCount: 0, countDocumentsResult: 0 });
    const service = new InfoSourceService(
      mockRepo,
      mockSmartTopicConfigRepo,
      model as unknown as jest.Mocked<any>,
    );

    await service.onModuleInit();

    // 应调用 create SEED_SOURCES.length 次
    expect(model.create).toHaveBeenCalledTimes(SEED_SOURCES.length);

    // 检查每条 create 调用的 category 与 SEED_SOURCES 一一对应
    model.create.mock.calls.forEach((call: any[], idx: number) => {
      const createdDoc = call[0] as Record<string, unknown>;
      expect(createdDoc.category).toBe(SEED_SOURCES[idx].category);
      expect(createdDoc.type).toBe('rss');
      expect(typeof createdDoc._id).toBe('string');
      expect((createdDoc._id as string).startsWith('src_')).toBe(true);
      // enabled 透传 seed.enabled ?? true：URL 不通的源设 false，其余 true
      expect(createdDoc.enabled).toBe(SEED_SOURCES[idx].enabled ?? true);
    });

    // 验证新 5 类 category 均有对应源被插入（覆盖精简后的所有分类）
    const createdCategories = new Set(
      model.create.mock.calls.map(
        (c: any[]) => (c[0] as Record<string, unknown>).category,
      ),
    );
    expect(createdCategories.has(InfoSourceCategory.ai)).toBe(true);
    expect(createdCategories.has(InfoSourceCategory.engineering)).toBe(true);
    expect(createdCategories.has(InfoSourceCategory.business)).toBe(true);
    expect(createdCategories.has(InfoSourceCategory.design)).toBe(true);
    expect(createdCategories.has(InfoSourceCategory.longform)).toBe(true);
  });

  // Case 3：seed 幂等 — countDocuments 全返回 1（已存在） → create 不被调用
  it('seed 幂等：已 seed 过时 countDocuments > 0 → create 不重复调用', async () => {
    const model = buildModelMock({ modifiedCount: 0, countDocumentsResult: 1 });
    const service = new InfoSourceService(
      mockRepo,
      mockSmartTopicConfigRepo,
      model as unknown as jest.Mocked<any>,
    );

    await service.onModuleInit();

    // countDocuments 应被调用 SEED_SOURCES.length 次（每条都查一下）
    expect(model.countDocuments).toHaveBeenCalledTimes(SEED_SOURCES.length);
    // 但 create 不应被调用
    expect(model.create).not.toHaveBeenCalled();
  });
});
