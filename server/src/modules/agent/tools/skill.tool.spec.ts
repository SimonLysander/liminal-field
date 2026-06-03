/**
 * skill.tool 单测 —— 三层校验 + body 直注。
 *
 * 测试用例(spec §5.2):
 * 1. skill 不存在 → 返回 toolResult({status:'not_found'})
 * 2. skill 存在但 agent 未启用 → 返回 toolResult({status:'invalid', kind:'not_enabled'})
 * 3. skill 启用 + agent 工具齐备 → 返回含 body 的 ToolResult JSON
 * 4. skill.requiredTools 不在 agentTools(配置漂移)→ 返回 toolResult({status:'invalid', kind:'missing_tools'})
 *
 * 错误契约:从 throw 改成 toolResult({status}),跟项目其余工具一致(2026-06-03 review)。
 *
 * 注意:AI SDK v6 工具的 execute 是函数,需要把 input + 一个空的 options 传进去。
 */
import { createSkillTool } from './skill.tool';
import type { SkillService } from '../../skill/skill.service';

// 构造 minimal SkillService(只 mock 用到的 findByName)。
function makeSkillService(
  findByName: jest.Mock,
): jest.Mocked<Pick<SkillService, 'findByName'>> {
  return { findByName };
}

// 调用 tool.execute 的薄包装:AI SDK 的 execute 期待 (input, options) 签名,
// options 在我们逻辑里没用到,塞 minimal 占位即可。
async function invoke(
  tool: ReturnType<typeof createSkillTool>,
  input: { name: string },
): Promise<string> {
  // tool 类型是 AI SDK 的 Tool;execute 接 (input, options) → 返回字符串(toolResult)。
  return await (
    tool as unknown as {
      execute: (
        input: unknown,
        options: { toolCallId: string; messages: unknown[] },
      ) => Promise<string>;
    }
  ).execute(input, { toolCallId: 't1', messages: [] });
}

describe('createSkillTool', () => {
  // 简洁 skill fixture:_id / name / body / requiredTools 是 tool 实际读的字段。
  const mkSkill = (over: Partial<Record<string, unknown>> = {}) => ({
    _id: 'sk1',
    name: 'critic',
    displayName: '严格批评',
    description: '挑稿子问题',
    whenToUse: '用户求严评',
    body: '严厉批评方法论 body 内容',
    requiredTools: ['web_search'],
    ...over,
  });

  // 小工具:把 toolResult 返回的 JSON 字符串解出来,只看 meta.status / detail / summary
  function parseResult(raw: string): {
    summary: string;
    detail?: string;
    meta?: {
      status?: string;
      kind?: string;
      missing?: string[];
      name?: string;
    };
  } {
    return JSON.parse(raw) as ReturnType<typeof parseResult>;
  }

  it('skill 不存在 → status=not_found', async () => {
    const findByName = jest.fn().mockResolvedValue(null);
    const tool = createSkillTool({
      skillService: makeSkillService(findByName) as unknown as SkillService,
      enabledSkillIds: ['sk1'],
      agentTools: ['web_search'],
    });
    const result = parseResult(await invoke(tool, { name: 'unknown' }));
    expect(result.meta?.status).toBe('not_found');
    expect(result.meta?.name).toBe('unknown');
    expect(result.summary).toMatch(/not found/i);
    expect(findByName).toHaveBeenCalledWith('unknown');
  });

  it('skill 存在但 agent 未启用 → status=invalid, kind=not_enabled', async () => {
    const findByName = jest.fn().mockResolvedValue(mkSkill());
    const tool = createSkillTool({
      skillService: makeSkillService(findByName) as unknown as SkillService,
      enabledSkillIds: [], // 空启用列表 → 即便 skill 存在也拒
      agentTools: ['web_search'],
    });
    const result = parseResult(await invoke(tool, { name: 'critic' }));
    expect(result.meta?.status).toBe('invalid');
    expect(result.meta?.kind).toBe('not_enabled');
    expect(result.meta?.name).toBe('critic');
  });

  it('skill 启用且工具齐备 → 返回含 body 的 ToolResult', async () => {
    const findByName = jest.fn().mockResolvedValue(mkSkill());
    const tool = createSkillTool({
      skillService: makeSkillService(findByName) as unknown as SkillService,
      enabledSkillIds: ['sk1'],
      agentTools: ['web_search'],
    });
    const result = await invoke(tool, { name: 'critic' });
    // toolResult 返 JSON 字符串,body 进 detail 字段;contain 检查不在乎包装层。
    // summary 是 skill.displayName(中文名);前端 ToolCallCard 工具名已显「加载技能」,
    // 不在 summary 重复 "Skill · " 前缀。
    expect(result).toContain('body 内容');
    expect(result).toContain('严格批评');
  });

  it('skill.requiredTools 不在 agentTools → status=invalid, kind=missing_tools(sanity 防御漂移)', async () => {
    const findByName = jest.fn().mockResolvedValue(mkSkill()); // requires web_search
    const tool = createSkillTool({
      skillService: makeSkillService(findByName) as unknown as SkillService,
      enabledSkillIds: ['sk1'],
      agentTools: [], // 漂移:配置时该挡住,这里防御性返 invalid
    });
    const result = parseResult(await invoke(tool, { name: 'critic' }));
    expect(result.meta?.status).toBe('invalid');
    expect(result.meta?.kind).toBe('missing_tools');
    expect(result.meta?.missing).toEqual(['web_search']);
    expect(result.detail).toMatch(/web_search/);
  });
});
