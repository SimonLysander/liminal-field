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
  ) {}

  async list(): Promise<Skill[]> {
    return this.repo.findAll();
  }

  async findById(id: string): Promise<Skill | null> {
    return this.repo.findById(id);
  }

  async findByName(name: string): Promise<Skill | null> {
    return this.repo.findByName(name);
  }

  async findByIds(ids: string[]): Promise<Skill[]> {
    return this.repo.findByIds(ids);
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    const exists = await this.repo.findByName(dto.name);
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
