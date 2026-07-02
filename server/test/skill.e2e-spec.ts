/**
 * skill-e2e.spec.ts —— Agent Skills 后端拼装链路端到端冒烟(Phase 1 Task 1.4)。
 *
 * 验证范围(spec §5):
 * 1. POST /admin/skills 创建 skill(slug + body + 元数据)
 * 2. SystemConfigService.saveAgentConfig 给用户自建 agent 启用该 skill(写 enabledSkillIds)
 * 3. AgentLifecycle.onBeforeChat 拼装 system prompt + tools:
 *    a) systemPrompt 含 <available_skills> 且列出 skill name/description/whenToUse
 *    b) systemPrompt 绝不含 skill.body(spec §5.1 红线)
 *    c) tools 字典含 'load_skill' key(tool.assembler 自动挂载)
 * 4. 关闭兜底:enabledSkillIds 为空时,既无 <available_skills> 也无 load_skill 工具
 *
 * 为什么不真聊 chat API:LLM 接口需要复杂 mock(OpenAI compatible 协议 + streamText 内部)。
 * 改聚焦在 onBeforeChat 拼装钩子上 —— 这正是 Phase 1 改动的归宿,validate 拼装契约即可。
 *
 * Settings controller 当前 PUT /agent-configs/:key body 类型未列 enabledSkillIds(Phase 0
 * 遗留,Phase 2 前端改动时会补上),故 e2e 直接走 SystemConfigService 写。
 */
import supertest from 'supertest';
import { TestContext, login } from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { SkillModule } from '../src/modules/skill/skill.module';
import { SystemConfigService } from '../src/modules/settings/system-config.service';
import { AgentLifecycle } from '../src/modules/agent/lifecycle/agent-lifecycle.service';
import { SkillService } from '../src/modules/skill/skill.service';
import type { AgentChatDto } from '../src/modules/agent/dto/agent-chat.dto';

describe('Agent Skills 后端拼装链路 (E2E)', () => {
  let ctx: TestContext;
  let cookie: string;
  let configService: SystemConfigService;
  let lifecycle: AgentLifecycle;
  let skillService: SkillService;

  // 用 ROADHOG 般独特的串保护 body assertion —— 显式列出来,grep prompt 含/不含一目了然
  const SKILL_BODY = '[CRITIC_METHODOLOGY_BODY_DO_NOT_LEAK_INTO_PROMPT]';
  const SKILL_NAME = 'critic';
  const SKILL_DESC = '挑稿子结构与逻辑问题';
  const SKILL_WHEN = '用户求"严点说"/"挑毛病"时';
  const AGENT_KEY = 'skill-e2e-agent';

  beforeAll(async () => {
    ctx = new TestContext();
    // SkillModule 已被 AgentModule import,SettingsModule 单独加(其他 e2e 套件惯例)
    await ctx.setup([SettingsModule, SkillModule]);
    cookie = await login(ctx.app);
    configService = ctx.app.get(SystemConfigService);
    lifecycle = ctx.app.get(AgentLifecycle);
    skillService = ctx.app.get(SkillService);
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  // ─── 步骤 1: 创 skill ─────────────────────────────────────────────
  let createdSkillId: string;

  it('POST /admin/skills 创建 skill', async () => {
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/admin/skills')
      .set('Cookie', cookie)
      .send({
        name: SKILL_NAME,
        displayName: '批评家',
        description: SKILL_DESC,
        whenToUse: SKILL_WHEN,
        body: SKILL_BODY,
        // 不放 requiredTools,避免与默认 agent.tools 校验冲突 → 启用时直接通过
        requiredTools: [],
      })
      .expect(201);
    expect(res.body.data.name).toBe(SKILL_NAME);
    expect(res.body.data._id).toBeDefined();
    createdSkillId = res.body.data._id as string;
  });

  // ─── 步骤 2: 给 agent 启用该 skill ───────────────────────────────
  it('启用 skill:agent.enabledSkillIds 包含 created id', async () => {
    // controller body 类型暂未列 enabledSkillIds(Phase 0 遗留),走 service 写。
    await configService.saveAgentConfig(AGENT_KEY, {
      name: 'Skill E2E Agent',
      description: '用于验证 skill 持久化链路',
      enabled: true,
      systemPrompt: '',
      tools: ['web_search', 'recall_memory'],
      tier: 'standard',
      enabledSkillIds: [createdSkillId],
    });
    const config = await configService.getAgentConfig(AGENT_KEY);
    expect(config?.enabledSkillIds).toContain(createdSkillId);
  });

  // ─── 步骤 3: 调 onBeforeChat 拼装,验证 prompt + tools ────────────
  it('onBeforeChat:systemPrompt 含 <available_skills> + skill 元数据,且 body 不出现', async () => {
    // 构造最小 AgentChatDto:仅 entryContext.sessionKey 必填,其他可空
    const dto = {
      entryContext: { sessionKey: 'test-session-e2e' },
      agentKey: AGENT_KEY,
    } as unknown as AgentChatDto;

    const { systemPrompt, tools } = await lifecycle.onBeforeChat(dto, {
      aiSystemPrompt: undefined,
      entrySystemPrompt: undefined,
      // allowedTools 留空 = 全工具集,让 Skill tool 也能挂上
      allowedTools: undefined,
      tier: 'standard',
      enabledSkillIds: [createdSkillId],
    });

    // a) systemPrompt 含 <available_skills> 元数据
    expect(systemPrompt).toContain('<available_skills>');
    expect(systemPrompt).toContain(`name: ${SKILL_NAME}`);
    expect(systemPrompt).toContain(`description: ${SKILL_DESC}`);
    expect(systemPrompt).toContain(`when_to_use: ${SKILL_WHEN}`);

    // b) 🚨 spec §5.1 红线:body 绝不能进 system prompt
    expect(systemPrompt).not.toContain(SKILL_BODY);
    expect(systemPrompt).not.toContain('CRITIC_METHODOLOGY_BODY');

    // c) tools 字典含 'load_skill' key —— tool.assembler 检测 enabledSkillIds 非空自动挂载
    expect(tools).toHaveProperty('load_skill');
    expect(typeof tools.load_skill).toBe('object');
  });

  // ─── 步骤 4: 兜底 —— 关闭 enabledSkillIds 后干净 ─────────────────
  it('enabledSkillIds 空 → 既无 <available_skills>,也无 load_skill 工具', async () => {
    const dto = {
      entryContext: { sessionKey: 'test-session-empty' },
      agentKey: AGENT_KEY,
    } as unknown as AgentChatDto;

    const { systemPrompt, tools } = await lifecycle.onBeforeChat(dto, {
      aiSystemPrompt: undefined,
      entrySystemPrompt: undefined,
      allowedTools: undefined,
      tier: 'standard',
      enabledSkillIds: [], // 空 → 完全不启用
    });

    expect(systemPrompt).not.toContain('<available_skills>');
    expect(tools).not.toHaveProperty('load_skill');
  });

  // ─── 步骤 5: Skill tool 闭环 —— findByName 路径 ──────────────────
  it('Skill 工具内部 findByName 能命中刚创建的 skill', async () => {
    // 直接通过 SkillService 验证一遍 findByName(tool 内部走的就是这条)
    const fetched = await skillService.findByName(SKILL_NAME);
    expect(fetched).not.toBeNull();
    expect(fetched?.name).toBe(SKILL_NAME);
    expect(fetched?.body).toBe(SKILL_BODY);
  });
});
