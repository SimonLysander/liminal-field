/**
 * Skill 工具 — agent 按 name 调起已启用的 Skill,系统注入 skill.body 作为 tool_result。
 *
 * 设计要点:
 * 1. body 永不进 system prompt(prompt.handler 只放轻量元数据 name/description/whenToUse);
 *    body 只在这里、agent 主动调起时,作为 tool_result 注入对话——按需载入,不浪费 context。
 * 2. 三层校验(配置层已挡一遍,这里防御性 sanity):
 *    a) skill 存在(findByName 命中)
 *    b) agent 已启用(enabledSkillIds 含 skill._id)
 *    c) requiredTools ⊆ agentTools(配置时硬校验过,但 skill update 与 agent 设置之间可能漂移)
 * 3. agent_tools 与 enabledSkillIds 由 tool.assembler 装配时以闭包传入,每次 chat 重组,无需运行时再查 config。
 *
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md §5.2
 */
import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';
import type { SkillService } from '../../skill/skill.service';

// 模块级 logger:tool() 工厂返回 plain config,无 class 容器;NestJS Logger 可在 module
// scope 使用("SkillTool" 是日志前缀,跟 ToolAssembler/PromptHandler 对应)。
const logger = new Logger('SkillTool');

export interface CreateSkillToolOpts {
  /** SkillService 实例;tool 仅用其只读方法(findByName)。 */
  skillService: SkillService;
  /** 本 agent 已启用的 skill _id 列表(AgentEntryConfig.enabledSkillIds 直传)。 */
  enabledSkillIds: string[];
  /** 本 agent 装配的工具名集合(AgentEntryConfig.tools);用于 sanity 检查 skill.requiredTools 是否齐备。 */
  agentTools: string[];
}

export function createSkillTool(opts: CreateSkillToolOpts) {
  // 启用列表归一为字符串集合,避免 ObjectId vs string 对比时漏命中(Mongo 返回是 ObjectId 类)。
  const enabledIdSet = new Set(opts.enabledSkillIds.map((id) => String(id)));

  return tool({
    description:
      'load_skill:加载一个已注册的技能(方法论)。传 name(slug)即可,系统会把对应的方法论正文注入对话作为下一步行动指引。' +
      '只在 <available_skills> 列出的 name 才可用,未列出的不要尝试。',
    inputSchema: jsonSchema<{ name: string }>({
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Skill 的 slug(如 "critic"、"polisher"),从 <available_skills> 取',
        },
      },
      required: ['name'],
    }),
    execute: async ({ name }: { name: string }) => {
      logger.debug(`execute: 收到调用 name=${JSON.stringify(name)}`);

      // 入参基本校验:空 name 直接返 invalid,不必触底层查询。
      if (typeof name !== 'string' || name.trim().length === 0) {
        return toolResult('Skill name 不能为空', undefined, {
          status: 'invalid',
        });
      }
      const trimmed = name.trim();

      // 三层校验。错误统一走 toolResult({status}),跟项目其余 17 个工具(search-content /
      // remember / web-fetch 等)的契约一致;不 throw —— throw 会让 AI SDK 直接把整轮断开,
      // 而 toolResult({status:'not_found'/'invalid'}) 模型能读到 hint 自我纠偏(换 skill 名 / 提示用户加工具)。
      const skill = await opts.skillService.findByName(trimmed);
      if (!skill) {
        logger.warn(`execute: skill 不存在 name=${trimmed}`);
        return toolResult(
          `Skill not found: ${trimmed}`,
          '当前可用 skill 见 <available_skills>',
          { status: 'not_found', name: trimmed },
        );
      }
      // ObjectId / string 兼容:findByName 返回的是 Mongoose 文档,_id 是 ObjectId 或 string。
      // 项目 Mongoose 文档 _id 类型确定是 Types.ObjectId | string,直接 toString() ?? '' 即可,
      // 无须三层 typeof 嵌套(ObjectId.toString 内部就是 toHexString,等价)。
      const skillIdStr =
        (skill as { _id?: { toString(): string } })._id?.toString() ?? '';
      if (!skillIdStr || !enabledIdSet.has(skillIdStr)) {
        logger.warn(
          `execute: skill 未授权 name=${trimmed} skillId=${skillIdStr} enabledCount=${enabledIdSet.size}`,
        );
        return toolResult('该 skill 未在本 agent 授权', undefined, {
          status: 'invalid',
          kind: 'not_enabled',
          name: trimmed,
        });
      }
      const missing = (skill.requiredTools ?? []).filter(
        (t) => !opts.agentTools.includes(t),
      );
      if (missing.length > 0) {
        logger.warn(
          `execute: skill 缺工具 name=${trimmed} missing=${missing.join(',')}`,
        );
        return toolResult(
          'Skill 缺前置工具',
          `管理员需在 Settings → Agent 配置 → 工具池补上 ${missing.join(', ')}`,
          {
            status: 'invalid',
            kind: 'missing_tools',
            missing,
            name: trimmed,
          },
        );
      }

      // 通过校验 → 返回 body(整段正文)。summary 给前端 UI 行内展示,detail 是模型读的方法论。
      // 用 displayName(中文名)不带 "Skill ·" 前缀:前端 ToolCallCard 工具名已经显"技能",
      // 行内最终展示为「✨ 技能 · <displayName>」,避免 "Skill · Skill · critic" 重复。
      const summary = skill.displayName || trimmed;
      logger.debug(
        `execute: 命中 name=${trimmed} bodyLength=${(skill.body ?? '').length}`,
      );
      return toolResult(summary, skill.body, {
        status: 'ok',
        skillName: trimmed,
      });
    },
  });
}
