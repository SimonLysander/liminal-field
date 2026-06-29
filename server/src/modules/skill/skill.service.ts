/**
 * SkillService — 全局 Skill 池的 CRUD 业务层。
 *
 * 跨模块协作:
 *   - 删除 skill 时 emit 'skill.deleted' 事件,SettingsService 监听并级联清理
 *     agentConfigs[].enabledSkillIds 引用(解耦 SkillModule <-> SettingsModule
 *     循环依赖,Task 0.6)。
 *
 * 错误约定:
 *   - 重名(create 或 update 改 name 撞别的 skill)→ 409 ConflictException
 *   - update 找不到 id → 404 NotFoundException
 *   - delete 找不到 id → 不抛,幂等(下游 Mongo $pull 也是幂等)
 */
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SkillRepository } from './skill.repository';
import type { CreateSkillDto } from './dto/create-skill.dto';
import type { UpdateSkillDto } from './dto/update-skill.dto';
import type { Skill } from './skill.entity';
import { PromptManagerService } from '../../infrastructure/prompt/prompt-manager.service';
import {
  BUILTIN_SKILLS,
  type BuiltinSkillDef,
} from '../../prompts/builtin-skills';

/** 删除 skill 时发出的事件 payload */
export const SKILL_DELETED_EVENT = 'skill.deleted';
export interface SkillDeletedEvent {
  skillId: string;
}

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name);

  constructor(
    private readonly repo: SkillRepository,
    private readonly eventBus: EventEmitter2,
    // 内置 skill 的 body 从 prompts/skills/*.md 渲染(@Global 注入,无需 module import)
    private readonly promptManager: PromptManagerService,
  ) {}

  // ── 内置 skill 解析（文件优先，Mongo 回落）──────────────────────────────
  // 内置 skill「是什么」定义在 prompts/builtin-skills.ts + skills/*.md,线上不可改;
  // 用户在 UI 新建的 skill 存 Mongo。下面的查询一律「内置 ∪ Mongo」,内置优先。
  // builtin 的 _id 即其 key(字符串),agent 的 enabledSkillIds 按 key 引用即可命中。

  /** 内置定义 → Skill 形状(body 实时从文件渲染,_id=key)。 */
  private builtinToSkill(def: BuiltinSkillDef): Skill {
    return {
      _id: def.key,
      name: def.key,
      displayName: def.displayName,
      description: def.description,
      whenToUse: def.whenToUse,
      body: this.promptManager.render(def.bodyFile),
      requiredTools: def.requiredTools,
    } as unknown as Skill;
  }

  /** keyOrId 命中内置(按 key)→ 返回内置 Skill;否则 null(交给 Mongo)。 */
  private findBuiltin(keyOrId: string): Skill | null {
    const def = BUILTIN_SKILLS.find((d) => d.key === keyOrId);
    return def ? this.builtinToSkill(def) : null;
  }

  async list(): Promise<Skill[]> {
    const builtins = BUILTIN_SKILLS.map((d) => this.builtinToSkill(d));
    const builtinNames = new Set(BUILTIN_SKILLS.map((d) => d.key));
    // 排除 Mongo 里与内置同名的残留(老库 seed 过的,被内置文件版本盖掉)
    const userCreated = (await this.repo.findAll()).filter(
      (s) => !builtinNames.has(s.name),
    );
    return [...builtins, ...userCreated];
  }

  async findById(id: string): Promise<Skill | null> {
    return this.findBuiltin(id) ?? (await this.repo.findById(id));
  }

  async findByName(name: string): Promise<Skill | null> {
    return this.findBuiltin(name) ?? (await this.repo.findByName(name));
  }

  async findByIds(ids: string[]): Promise<Skill[]> {
    // 逐个分流:命中内置 key 走文件,其余按 Mongo ObjectId 批量查
    const out: Skill[] = [];
    const mongoIds: string[] = [];
    for (const id of ids) {
      const b = this.findBuiltin(id);
      if (b) out.push(b);
      else mongoIds.push(id);
    }
    if (mongoIds.length > 0) out.push(...(await this.repo.findByIds(mongoIds)));
    return out;
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    // 用 findByName(含内置)防止用户新建 skill 撞内置 key
    const exists = await this.findByName(dto.name);
    if (exists) {
      throw new ConflictException(`Skill name 已存在: ${dto.name}`);
    }
    this.logger.debug(`creating skill name=${dto.name}`);
    return this.repo.create(dto);
  }

  async update(id: string, dto: UpdateSkillDto): Promise<Skill> {
    // 改 name 时先校验新 name 没被别的 skill 占用
    if (dto.name) {
      const other = await this.repo.findByName(dto.name);
      // 命中自己不算冲突(允许只改其他字段时 name 不变也走 update 路径)
      if (other && String(other._id) !== String(id)) {
        throw new ConflictException(`Skill name 已存在: ${dto.name}`);
      }
    }
    const updated = await this.repo.updateById(id, dto);
    if (!updated) {
      throw new NotFoundException(`Skill not found: ${id}`);
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    // 幂等:找不到不抛(场景:并发删 / 重试);删除后发事件触发级联清理
    this.logger.debug(`deleting skill id=${id}`);
    await this.repo.deleteById(id);
    const payload: SkillDeletedEvent = { skillId: id };
    this.eventBus.emit(SKILL_DELETED_EVENT, payload);
  }
}
