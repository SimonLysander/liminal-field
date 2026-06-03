/**
 * SystemConfigService 单测 — 聚焦 Task 0.5/0.6/0.7 的 Skill 关联校验/级联清理。
 *
 * 与项目内 *.service.spec.ts 风格对齐:直接 new + cast mock,不上 Test.createTestingModule。
 * 不覆盖 onModuleInit/git/provider 等历史业务路径(那些有独立 e2e + 手动验收)。
 */
import { BadRequestException } from '@nestjs/common';
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

describe('SystemConfigService.saveAgentConfig — Skill 校验(Task 0.5)', () => {
  it('启用 skill 但 agent 缺工具 → 400 BadRequest,不写库', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    // 现有 agent 只有 recall_memory,没 web_search
    const existing = mkAgent({ tools: ['recall_memory'] });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    // 要启用的 skill 需要 web_search
    mockSkillService.findById.mockResolvedValue({
      _id: 'sk1',
      name: 'critic',
      requiredTools: ['web_search'],
    } as never);

    await expect(
      service.saveAgentConfig('writing-advisor', { enabledSkillIds: ['sk1'] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockRepo.patch).not.toHaveBeenCalled();
  });

  it('启用 skill 且 agent 工具齐备 → 通过 + 写库', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent({ tools: ['web_search', 'recall_memory'] });
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findById.mockResolvedValue({
      _id: 'sk1',
      name: 'critic',
      requiredTools: ['web_search'],
    } as never);

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

  it('启用的 skill 不存在 → 400 BadRequest', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent();
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);
    mockSkillService.findById.mockResolvedValue(null);

    await expect(
      service.saveAgentConfig('writing-advisor', {
        enabledSkillIds: ['nope'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enabledSkillIds 为空 → 不查 skill 直接通过(默认行为透明)', async () => {
    const { service, mockRepo, mockSkillService } = createMocks();
    const existing = mkAgent();
    mockRepo.get.mockResolvedValue({ agentConfigs: [existing] } as never);

    await service.saveAgentConfig('writing-advisor', { enabled: false });

    expect(mockSkillService.findById).not.toHaveBeenCalled();
    expect(mockRepo.patch).toHaveBeenCalled();
  });
});
