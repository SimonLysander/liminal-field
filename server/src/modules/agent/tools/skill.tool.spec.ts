/**
 * skill.tool 单测 —— 三层校验 + body 直注。
 *
 * 测试用例(spec §5.2):
 * 1. skill 不存在 → throw not_found
 * 2. skill 存在但 agent 未启用 → throw not_enabled(防御:配置层应该挡住)
 * 3. skill 启用 + agent 工具齐备 → 返回含 body 的 ToolResult JSON
 * 4. skill.requiredTools 不在 agentTools(配置漂移)→ throw requires
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
    description: '挑稿子问题',
    whenToUse: '用户求严评',
    body: '严厉批评方法论 body 内容',
    requiredTools: ['web_search'],
    ...over,
  });

  it('skill 不存在 → throw not found', async () => {
    const findByName = jest.fn().mockResolvedValue(null);
    const tool = createSkillTool({
      skillService: makeSkillService(findByName) as unknown as SkillService,
      enabledSkillIds: ['sk1'],
      agentTools: ['web_search'],
    });
    await expect(invoke(tool, { name: 'unknown' })).rejects.toThrow(
      /not found/i,
    );
    expect(findByName).toHaveBeenCalledWith('unknown');
  });

  it('skill 存在但 agent 未启用 → throw not enabled', async () => {
    const findByName = jest.fn().mockResolvedValue(mkSkill());
    const tool = createSkillTool({
      skillService: makeSkillService(findByName) as unknown as SkillService,
      enabledSkillIds: [], // 空启用列表 → 即便 skill 存在也拒
      agentTools: ['web_search'],
    });
    await expect(invoke(tool, { name: 'critic' })).rejects.toThrow(
      /not enabled/i,
    );
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
    expect(result).toContain('body 内容');
    expect(result).toContain('Skill · critic');
  });

  it('skill.requiredTools 不在 agentTools → throw requires(sanity 防御漂移)', async () => {
    const findByName = jest.fn().mockResolvedValue(mkSkill()); // requires web_search
    const tool = createSkillTool({
      skillService: makeSkillService(findByName) as unknown as SkillService,
      enabledSkillIds: ['sk1'],
      agentTools: [], // 漂移:配置时该挡住,但 sanity 还是 throw
    });
    await expect(invoke(tool, { name: 'critic' })).rejects.toThrow(
      /requires.*web_search/i,
    );
  });
});
