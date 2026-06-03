/**
 * UpdateSkillDto — 更新 Skill 的请求体(全字段可选)。
 *
 * 走 @nestjs/mapped-types 的 PartialType 自动从 CreateSkillDto 派生,
 * 避免手抄一份字段日久跟 Create 漂移(2026-06-03 review F4-a)。
 * 字段语义变更只动 CreateSkillDto 一处,自动反映过来。
 */
import { PartialType } from '@nestjs/mapped-types';
import { CreateSkillDto } from './create-skill.dto';

export class UpdateSkillDto extends PartialType(CreateSkillDto) {}
