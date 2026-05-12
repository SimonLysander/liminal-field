import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { SystemConfig } from './system-config.entity';

const SINGLETON_ID = 'singleton';

/**
 * SystemConfigRepository — 系统配置读写。
 *
 * 单例模式：始终操作 _id = 'singleton' 的文档。
 * upsert 保证首次写入自动创建，无需手动初始化。
 */
@Injectable()
export class SystemConfigRepository {
  constructor(
    @Inject(getModelToken(SystemConfig.name))
    private readonly model: ReturnModelType<typeof SystemConfig>,
  ) {}

  async get(): Promise<SystemConfig | null> {
    return this.model.findById(SINGLETON_ID);
  }

  /** 部分更新：只更新传入的字段 */
  async patch(
    fields: Partial<Omit<SystemConfig, '_id'>>,
  ): Promise<SystemConfig> {
    // upsert: true guarantees a document is always returned
    const doc = await this.model.findByIdAndUpdate(
      SINGLETON_ID,
      { $set: { ...fields, updatedAt: new Date() } },
      { upsert: true, returnDocument: 'after' },
    );
    return doc;
  }
}
