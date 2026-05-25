import { Inject, Injectable } from '@nestjs/common';
import { getModelToken } from 'nestjs-typegoose';
import type { ReturnModelType } from '@typegoose/typegoose';
import { ImportSession, ImportAssetRef } from './import-session.entity';

@Injectable()
export class ImportSessionRepository {
  constructor(
    @Inject(getModelToken(ImportSession.name))
    private readonly model: ReturnModelType<typeof ImportSession>,
  ) {}

  async create(input: {
    id: string;
    title: string;
    assets: ImportAssetRef[];
  }): Promise<ImportSession> {
    const now = new Date();
    return this.model.create({
      _id: input.id,
      title: input.title,
      assets: input.assets,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
    });
  }

  async findById(id: string): Promise<ImportSession | null> {
    return this.model.findById(id);
  }

  async updateAssets(id: string, assets: ImportAssetRef[]): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: { assets } });
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id });
  }
}
