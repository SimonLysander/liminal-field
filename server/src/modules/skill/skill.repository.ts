/**
 * SkillRepository — Mongoose 包装,只暴露 service 用的查询/写入方法。
 *
 * 命名:findById/findByName/findByIds 三种查询路径覆盖运行时所有访问场景
 * (controller 列表/编辑、prompt.handler 批量、Skill tool 按 name 调起)。
 */
import { Inject, Injectable } from '@nestjs/common';
import { getModelToken } from 'nestjs-typegoose';
import type { ReturnModelType } from '@typegoose/typegoose';
import { Skill } from './skill.entity';

@Injectable()
export class SkillRepository {
  constructor(
    @Inject(getModelToken('Skill'))
    private readonly model: ReturnModelType<typeof Skill>,
  ) {}

  async findAll(): Promise<Skill[]> {
    return this.model.find().sort({ createdAt: -1 });
  }

  async findById(id: string): Promise<Skill | null> {
    return this.model.findById(id);
  }

  async findByName(name: string): Promise<Skill | null> {
    return this.model.findOne({ name });
  }

  /** 批量查询(prompt.handler 注入 <available_skills> 用) */
  async findByIds(ids: string[]): Promise<Skill[]> {
    if (!ids.length) return [];
    return this.model.find({ _id: { $in: ids } });
  }

  async create(input: Partial<Skill>): Promise<Skill> {
    return this.model.create(input);
  }

  async updateById(id: string, input: Partial<Skill>): Promise<Skill | null> {
    return this.model.findByIdAndUpdate(id, input, { new: true });
  }

  async deleteById(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id);
  }
}
