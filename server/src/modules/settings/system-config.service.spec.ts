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

  // SystemConfigService 现在需要 PromptManagerService(第四个参数)
  // 用于 getReportAnalystEntry() 从 settings/digest-report-analyst.md 渲染默认 system prompt
  const mockPromptManager = {
    render(): string {
      return '报告分析师默认 system prompt';
    },
  } as never;
  const service = new SystemConfigService(
    mockRepo,
    mockContentRepo,
    mockSkillService,
    mockPromptManager,
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

describe('SystemConfigService.saveAgentConfig — Skill 校验(Task 0.5 + F3 收紧两路径)', () => {
  // ── 路径 B(added 子集)— added 全合规 / added 不合规 / added 不存在 ──

  it('case 4:input 全 added 且全合规 → validate 通过,cleaned 为空,写库', async () => {
    // 路径 B:existing.enabledSkillIds=[], input.enabledSkillIds=['sk1'](全 added)
    // sk1 存在且 requiredTools ⊆ agent.tools → validate 通过,cleaned 空。
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

    const result = await service.saveAgentConfig('writing-advisor', {
      enabledSkillIds: ['sk1'],
    });

    expect(result.cleaned).toEqual([]);
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

  it('case 6:input 全 added 但缺工具 → 400 BadRequest(用户主动 opt-in 不合规要让看到)', async () => {
    // F3 收紧:added 是用户本次主动新加的,不静默吞 — skill 缺工具直接 400。
    // 错误信息含 skill name 和 missing tools,前端可弹对话框。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({ tools: ['recall_memory'] }); // 没有 web_search
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([
      {
        _id: 'sk1',
        name: 'critic',
        requiredTools: ['web_search'],
      },
    ] as never);

    await expect(
      service.saveAgentConfig('writing-advisor', {
        enabledSkillIds: ['sk1'],
      }),
    ).rejects.toThrow(/critic.*web_search/);
    expect(mockRepo.patch).not.toHaveBeenCalled();
  });

  it('case 5:input 全 added 但 skill 不存在 → 400 BadRequest(含 skillId)', async () => {
    // F3 收紧:added 主动 opt-in,skill 不存在不能静默吞,直接 400。
    // 错误信息含被点的 skillId,告诉用户哪个 skill 找不到。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({ tools: ['web_search', 'recall_memory'] });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findByIds.mockResolvedValue([] as never);

    await expect(
      service.saveAgentConfig('writing-advisor', {
        enabledSkillIds: ['ghost-id'],
      }),
    ).rejects.toThrow(/ghost-id/);
    expect(mockRepo.patch).not.toHaveBeenCalled();
  });

  // ── 路径 A(没传 enabledSkillIds)/ 路径 B(空数组、混合)边界 ──

  it('case 1:input 没传 enabledSkillIds(只改 enabled)→ existing 走 autoCleanup,不查 skill', async () => {
    // 路径 A 触发:existing.enabledSkillIds=[] 时 cleanup 直接 short-circuit,不查 findByIds。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent();
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);

    await service.saveAgentConfig('writing-advisor', { enabled: false });

    expect(mockSkillService.findByIds).not.toHaveBeenCalled();
    expect(mockRepo.patch).toHaveBeenCalled();
  });

  it('case 2:input 显式 enabledSkillIds=[] → 不 cleanup 也不 validate,直接 [] + cleaned=[]', async () => {
    // 路径 B 但 inherited=[] + added=[] → 两条分支都跳过,enabledSkillIds=[] 落库。
    // 关键:不该误查 skill(existing 哪怕有内容也不查 — 用户清空了)。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({ enabledSkillIds: ['sk-old'] });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);

    const result = await service.saveAgentConfig('writing-advisor', {
      enabledSkillIds: [],
    });

    expect(result.cleaned).toEqual([]);
    expect(mockSkillService.findByIds).not.toHaveBeenCalled();
    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [expect.objectContaining({ enabledSkillIds: [] })],
    });
  });

  // ── 路径 B 的混合 case 7 / case 8 ──

  it('case 7:混合 inherited(孤儿)+ added(不合规)→ added 先 400,inherited 不静默吞', async () => {
    // F3 收紧关键:added 不合规先挡 — 不能因为 inherited 有孤儿就把 added 的问题盖住。
    // 期望抛 BadRequest(含 added 那条 skill 的 name + missing),merged 不入库。
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({
      tools: ['web_search', 'recall_memory'],
      enabledSkillIds: ['sk-old'], // 老 skill,inherited 候选
    });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    // findByIds 只对 added (['sk-new']) 调用 —— inherited 的 cleanup 阶段不会走到。
    mockSkillService.findByIds.mockResolvedValue([
      {
        _id: 'sk-new',
        name: 'bad-add',
        requiredTools: ['missing_tool'], // agent 没这个工具
      },
    ] as never);

    await expect(
      service.saveAgentConfig('writing-advisor', {
        tools: ['recall_memory'], // 改 tools 让 sk-old 孤儿化
        enabledSkillIds: ['sk-old', 'sk-new'], // sk-old 是 inherited 孤儿,sk-new 是 added 不合规
      }),
    ).rejects.toThrow(/bad-add.*missing_tool/);
    expect(mockRepo.patch).not.toHaveBeenCalled();
  });

  it('case 8:混合 inherited(孤儿)+ added(全合规)→ cleanup 静默清孤儿 + added 入库', async () => {
    // 路径 B 的"好"分支:added 全过 validate,inherited 中孤儿被 cleanup 静默剔除,
    // cleaned 透回给前端 toast 提醒"这个老 skill 因为工具变化被自动关了"。
    // 最终 enabledSkillIds = [keptInherited..., added...]
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({
      tools: ['web_search', 'recall_memory'],
      enabledSkillIds: ['sk-keep', 'sk-orphan'],
    });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    // saveAgentConfig 会调 findByIds 两次:一次校验 added,一次 cleanup inherited
    mockSkillService.findByIds
      // 第 1 次:validateSkillsStrict 校验 added=['sk-new']
      .mockResolvedValueOnce([
        {
          _id: 'sk-new',
          name: 'new-skill',
          requiredTools: ['recall_memory'], // 合规
        },
      ] as never)
      // 第 2 次:autoCleanupOrphanSkills 跑 inherited=['sk-keep','sk-orphan']
      .mockResolvedValueOnce([
        {
          _id: 'sk-keep',
          name: 'keeper',
          requiredTools: ['recall_memory'], // 合规,保留
        },
        {
          _id: 'sk-orphan',
          name: 'orphan',
          requiredTools: ['web_search'], // 不在新 tools 里,会被清
        },
      ] as never);

    const result = await service.saveAgentConfig('writing-advisor', {
      tools: ['recall_memory'], // 去掉 web_search → sk-orphan 孤儿化
      enabledSkillIds: ['sk-keep', 'sk-orphan', 'sk-new'],
    });

    expect(result.cleaned).toEqual([
      { agent: 'writing-advisor', skillName: 'orphan' },
    ]);
    expect(mockRepo.patch).toHaveBeenCalledWith({
      agentConfigs: [
        expect.objectContaining({
          tools: ['recall_memory'],
          // sk-keep(inherited 保留)+ sk-new(added 合规)
          enabledSkillIds: ['sk-keep', 'sk-new'],
        }),
      ],
    });
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

  it('case 3:input 全 inherited(没新增)同时改 tools → inherited 走 cleanup,无 validate', async () => {
    // F3 收紧后的路径 B - case 3:input.enabledSkillIds 全是 existing 的子集(没主动新加),
    // 这些 skill 走 autoCleanup 而非 strict validate(因为它们不是用户本次主动 opt-in)。
    // sk1 inherited 但 tools 变化致孤儿 → 静默剔除 + cleaned 透回,不 400。
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
      enabledSkillIds: ['sk1'], // sk1 ⊆ existing.enabledSkillIds → 全 inherited
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
