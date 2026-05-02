/**
 * GalleryPostMetaRepository — 画廊帖子 MongoDB 元数据的读写封装。
 * 支持按 contentItemId 查询、upsert（创建或更新）、删除。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { GalleryPostMeta } from './gallery-post-meta.entity';

@Injectable()
export class GalleryPostMetaRepository {
  constructor(
    @Inject(getModelToken(GalleryPostMeta.name))
    private readonly model: ReturnModelType<typeof GalleryPostMeta>,
  ) {}

  async findByContentItemId(contentItemId: string): Promise<GalleryPostMeta | null> {
    return this.model.findOne({ contentItemId }).lean().exec();
  }

  /**
   * 按 contentItemId upsert 元数据。
   * 使用 $setOnInsert 保证插入时写入 contentItemId，$set 更新业务字段。
   */
  async upsert(
    contentItemId: string,
    update: Partial<Pick<GalleryPostMeta, 'photos' | 'coverPhotoFileName' | 'tags'>>,
  ): Promise<GalleryPostMeta> {
    const result = await this.model
      .findOneAndUpdate(
        { contentItemId },
        { $set: update, $setOnInsert: { contentItemId } },
        { upsert: true, new: true, lean: true },
      )
      .exec();
    return result!;
  }

  async deleteByContentItemId(contentItemId: string): Promise<void> {
    await this.model.deleteOne({ contentItemId }).exec();
  }
}
