/**
 * Skills API 客户端 — 接 /admin/skills CRUD。
 *
 * 设计:
 * - Skill 是全局池,管理员 CRUD;agent 通过 enabledSkillIds 引用授权。
 * - body 字段在 skill detail 里全文返回,前端编辑直接读写,不分两段拉。
 * - 跟 settings.ts 同款 request() 封装(自动带 /api/v1 + credentials)。
 *
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md §4.1 §6.2
 */
import { request } from './request';

/** Skill 实体 — 跟后端 server/src/modules/skill/skill.entity.ts 对应 */
export interface Skill {
  _id: string;
  name: string;
  displayName: string;
  description: string;
  whenToUse: string;
  body: string;
  /** 该 skill 必需的系统工具名列表(校验 ⊆ agent.tools) */
  requiredTools: string[];
  createdAt: string;
  updatedAt: string;
}

/** 新建入参:除 _id / 时间戳之外的所有字段 */
export type CreateSkillInput = Omit<Skill, '_id' | 'createdAt' | 'updatedAt'>;

/** 更新入参:全部 optional(对应后端 PartialType(CreateSkillDto)) */
export type UpdateSkillInput = Partial<CreateSkillInput>;

export const skillsApi = {
  /** 列表:按 createdAt 倒序 */
  list: () => request<Skill[]>('/admin/skills'),

  /** 新建 — 409 重名,400 字段非法 */
  create: (input: CreateSkillInput) =>
    request<Skill>('/admin/skills', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 更新 — 404 找不到,409 改 name 撞别的 */
  update: (id: string, input: UpdateSkillInput) =>
    request<Skill>(`/admin/skills/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  /** 删除 — 幂等;后端发 skill.deleted 事件,SystemConfig 清理引用 */
  delete: (id: string) =>
    request<{ ok: true }>(`/admin/skills/${id}`, { method: 'DELETE' }),
};
