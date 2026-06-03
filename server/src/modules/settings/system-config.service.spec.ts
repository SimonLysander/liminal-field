/**
 * SystemConfigService 单测 — 聚焦 Task 0.5/0.6/0.7 的 Skill 关联校验/级联清理。
 *
 * 与项目内 *.service.spec.ts 风格对齐:直接 new + cast mock,不上 Test.createTestingModule。
 * 不覆盖 onModuleInit/git/provider 等历史业务路径(那些有独立 e2e + 手动验收)。
 */
import { SystemConfigService } from './system-config.service';
import type { SystemConfigRepository } from './system-config.repository';
import type { ContentRepoService } from '../content/content-repo.service';
import type { SkillService } from '../skill/skill.service';
import type { AgentEntryConfig } from './system-config.entity';

function createMocks() {
  const mockRepo = {
    get: jest.fn(),
    patch: jest.fn(),
  } as unknown as jest.Mocked<SystemConfigRepository>;

  const mockContentRepo = {
    repoRoot: '/tmp/test',
  } as unknown as ContentRepoService;

  const mockSkillService = {
    findById: jest.fn(),
    findByName: jest.fn(),
    findByIds: jest.fn(),
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<SkillService>;

  const service = new SystemConfigService(
    mockRepo,
    mockContentRepo,
    mockSkillService,
  );

  return { service, mockRepo, mockSkillService };
}

/** 构造一个最简 AgentEntryConfig fixture(后续用 ...override 改字段) */
function mkAgent(overrides: Partial<AgentEntryConfig> = {}): AgentEntryConfig {
  return {
    key: 'writing-advisor',
    name: '写作顾问',
    description: '',
    enabled: true,
    systemPrompt: '',
    tools: ['web_search', 'recall_memory'],
    tier: 'standard',
    providerId: '',
    flashProviderId: '',
    standardProviderId: '',
    thinkProviderId: '',
    visionProviderId: '',
    enabledSkillIds: [],
    ...overrides,
  };
}

describe('SystemConfigService.saveAgentConfig — Skill 校验(Task 0.5 + F3 合并)', () => {
  it('启用 skill 但 agent 缺工具 → cleanup 剔除 + cleaned 透回,不再 400', async () => {
    // F3 路径合并后:cleanup 先跑把孤儿剔掉,validate 看到空列表通过。
    // 语义变化:老 Task 0.5 是 400 拒;新逻辑友好剔除 + 前端 toast 告知"缺工具"。
    // 前端 SkillsSection 还有 disabledReason 在 popover 上挡用户(不会点出来这条路径)。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({ tools: ['recall_memory'] });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([
      {
        _id: 'sk1',
        name: 'critic',
        requiredTools: ['web_search'],
      },
    ] as never);

    const result = await service.saveAgentConfig('writing-advisor', {
      enabledSkillIds: ['sk1'],
    });

    expect(result.cleaned).toEqual([
      { agent: 'writing-advisor', skillName: 'critic' },
    ]);
    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [expect.objectContaining({ enabledSkillIds: [] })],
    });
  });

  it('启用 skill 且 agent 工具齐备 → 通过 + 写库', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({ tools: ['web_search', 'recall_memory'] });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([
      {
        _id: 'sk1',
        name: 'critic',
        requiredTools: ['web_search'],
      },
    ] as never);

    await service.saveAgentConfig('writing-advisor', {
      enabledSkillIds: ['sk1'],
    });

    expect(mockRepo.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentConfigs: expect.arrayContaining([
          expect.objectContaining({
            key: 'writing-advisor',
            enabledSkillIds: ['sk1'],
          }),
        ]),
      }),
    );
  });

  it('启用的 skill 不存在 → cleanup 兜底丢弃 + cleaned 空(无 displayName 不报)', async () => {
    // F3 路径合并后:不存在的 skillId 落到 cleanup 的"已删 skill"分支,
    // 静默丢弃 + warn 日志,cleaned 不带这条(没 displayName 可显)。
    // 这种 case 实际上前端 chip 选择器只让选已存在的,不会走到这里。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent();
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([] as never);

    const result = await service.saveAgentConfig('writing-advisor', {
      enabledSkillIds: ['nope'],
    });

    expect(result.cleaned).toEqual([]);
    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [expect.objectContaining({ enabledSkillIds: [] })],
    });
  });

  it('enabledSkillIds 为空 → 不查 skill 直接通过(默认行为透明)', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent();
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);

    await service.saveAgentConfig('writing-advisor', { enabled: false });

    expect(mockSkillService.findByIds).not.toHaveBeenCalled();
    expect(mockRepo.patch).toHaveBeenCalled();
  });
});

describe('SystemConfigService.saveAgentConfig — agent 改 tools 自动清理孤儿 skill(Task 0.7)', () => {
  it('改 tools 移除了某 skill 依赖的工具 → 自动从 enabledSkillIds 移除该 skill', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({
      tools: ['web_search', 'recall_memory'],
      enabledSkillIds: ['sk1'],
    });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([
      {
        _id: 'sk1',
        name: 'critic',
        requiredTools: ['web_search'],
      },
    ] as never);

    // 用户只改 tools(去掉 web_search),没传 enabledSkillIds
    const result = await service.saveAgentConfig('writing-advisor', {
      tools: ['recall_memory'],
    });

    // sk1 被自动剔除
    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [
        expect.objectContaining({
          key: 'writing-advisor',
          tools: ['recall_memory'],
          enabledSkillIds: [],
        }),
      ],
    });
    // 返回 cleaned 信息供前端展示
    expect(result.cleaned).toEqual([
      { agent: 'writing-advisor', skillName: 'critic' },
    ]);
  });

  it('改 tools 但所有 skill 依赖仍满足 → enabledSkillIds 不动,cleaned 为空', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({
      tools: ['web_search', 'recall_memory'],
      enabledSkillIds: ['sk1'],
    });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([
      {
        _id: 'sk1',
        name: 'critic',
        requiredTools: ['web_search'],
      },
    ] as never);

    const result = await service.saveAgentConfig('writing-advisor', {
      tools: ['web_search', 'recall_memory', 'sub_agent'], // 加工具,不移除
    });

    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [
        expect.objectContaining({
          enabledSkillIds: ['sk1'], // 保留
        }),
      ],
    });
    expect(result.cleaned).toEqual([]);
  });

  it('改 tools 但 skill 已被删 → 兜底丢弃 + 不进 cleaned 返回(无可读 displayName)', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({
      tools: ['web_search'],
      enabledSkillIds: ['sk-ghost'],
    });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([] as never);

    const result = await service.saveAgentConfig('writing-advisor', {
      tools: ['recall_memory'],
    });

    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [expect.objectContaining({ enabledSkillIds: [] })],
    });
    expect(result.cleaned).toEqual([]); // 兜底清理,但不报告(skill 无名)
  });

  it('显式 enabledSkillIds 同时改 tools → 先 cleanup 再 validate(F3 路径合并)', async () => {
    // 2026-06-03 review F3:saveAgentConfig 不再按 input.enabledSkillIds 分流。
    // 显式带 enabledSkillIds 同时改 tools 的场景下:
    //   - 老逻辑只走 validate → 因 sk1 缺 web_search 而 400
    //   - 新逻辑先 cleanup 把 sk1 剔掉 → validate 空列表 → 通过 + cleaned 透回
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({
      tools: ['web_search', 'recall_memory'],
      enabledSkillIds: ['sk1'],
    });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([
      {
        _id: 'sk1',
        name: 'critic',
        requiredTools: ['web_search'],
      },
    ] as never);

    const result = await service.saveAgentConfig('writing-advisor', {
      tools: ['recall_memory'], // 去掉 web_search
      enabledSkillIds: ['sk1'], // 显式带 sk1(老路径会 400)
    });

    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [
        expect.objectContaining({
          tools: ['recall_memory'],
          enabledSkillIds: [], // cleanup 剔除
        }),
      ],
    });
    expect(result.cleaned).toEqual([
      { agent: 'writing-advisor', skillName: 'critic' },
    ]);
  });

  it('findByIds 抛错时 existing 数组不被 mutate(F10 patch 顺序)', async () => {
    // 2026-06-03 review F10:next 用函数式构造而非 existing[idx] = merged。
    // 校验阶段抛错(Mongo 瞬时故障)时 existing 数组不应被中间 merge 写脏,
    // 否则 in-memory cache 已坏,下次读到错状态。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({
      key: 'writing-advisor',
      tools: ['recall_memory'],
      enabledSkillIds: [],
    });
    const existingArr = [existing];
    mockRepo.get.mockResolvedValue({ agentConfigs: existingArr } as never);
    // findByIds Mongo 故障 → cleanup/validate 阶段抛
    mockSkillService.findByIds.mockRejectedValue(new Error('mongo conn lost'));

    await expect(
      service.saveAgentConfig('writing-advisor', {
        enabledSkillIds: ['sk1'],
      }),
    ).rejects.toThrow(/mongo conn lost/);

    // 关键:existingArr[0] 还是原引用,字段未被中间 merge 写脏
    expect(existingArr[0]).toBe(existing);
    expect(existingArr[0].enabledSkillIds).toEqual([]);
    expect(mockRepo.patch).not.toHaveBeenCalled();
  });
});

describe('SystemConfigService.cleanupSkillReferences — 删 Skill 级联清理(Task 0.6)', () => {
  it('删 skill 后,所有 agentConfig.enabledSkillIds 里该 id 都被移除', async () => {
    const { service, mockRepo } = createMocks();
    const agentA = mkAgent({ key: 'a', enabledSkillIds: ['sk1', 'sk2'] });
    const agentB = mkAgent({ key: 'b', enabledSkillIds: ['sk1'] });
    const agentC = mkAgent({ key: 'c', enabledSkillIds: ['sk3'] }); // 不涉及
    mockRepo.get.mockResolvedValue({
      agentConfigs: [agentA, agentB, agentC],
    } as never);

    await service.cleanupSkillReferences({ skillId: 'sk1' });

    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [
        expect.objectContaining({ key: 'a', enabledSkillIds: ['sk2'] }),
        expect.objectContaining({ key: 'b', enabledSkillIds: [] }),
        expect.objectContaining({ key: 'c', enabledSkillIds: ['sk3'] }),
      ],
    });
  });

  it('没有 agent 引用该 skill → 不写库(避免无意义 patch)', async () => {
    const { service, mockRepo } = createMocks();
    const agentA = mkAgent({ enabledSkillIds: ['sk-other'] });
    mockRepo.get.mockResolvedValue({ agentConfigs: [agentA] } as never);

    await service.cleanupSkillReferences({ skillId: 'sk1' });

    expect(mockRepo.patch).not.toHaveBeenCalled();
  });

  it('agentConfigs 为空 → 直接 return,不查不写', async () => {
    const { service, mockRepo } = createMocks();
    mockRepo.get.mockResolvedValue({ agentConfigs: [] } as never);

    await service.cleanupSkillReferences({ skillId: 'sk1' });

    expect(mockRepo.patch).not.toHaveBeenCalled();
  });

  it('repo.get/patch 抛错 → handler 吞掉不 rethrow(F2 fire-and-forget)', async () => {
    // 2026-06-03 review F2:EventEmitter handler 抛出会变 unhandledRejection,
    // 这里要确保 try-catch 兜住,且 logger.error 被调用。
    const { service, mockRepo } = createMocks();
    mockRepo.get.mockRejectedValue(new Error('mongo down'));
    // logger 是私有,改成监听 error spy(直接 spy 实例方法)
    const errorSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => {});

    // 不应 throw
    await expect(
      service.cleanupSkillReferences({ skillId: 'sk1' }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
