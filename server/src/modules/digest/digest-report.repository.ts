/**
 * DigestReportRepository — 简报报告持久化层。
 *
 * 跟笔记/文集的 ContentItem 没关系——digest 报告独立 collection,设计上不进 git、
 * 不走 publishedVersion 状态机、不挂 NavNode 树。直接增删查就够。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { DigestReport } from './digest-report.entity';
import type { Finding } from './digest-task.entity';

export interface CreateDigestReportInput {
  _id: string;
  topicId: string;
  taskId: string;
  headline: string;
  markdown: string;
  findings: Finding[];
  publishedAt: Date;
}

@Injectable()
export class DigestReportRepository {
  constructor(
    @Inject(getModelToken(DigestReport.name))
    private readonly model: ReturnModelType<typeof DigestReport>,
  ) {}

  async create(input: CreateDigestReportInput): Promise<DigestReport> {
    return this.model.create(input);
  }

  async findById(id: string): Promise<DigestReport | null> {
    return this.model.findById(id).exec();
  }

  /** 按 topic 列报告,默认按 publishedAt 倒序(最新在前)。
   * 公开端目录页 / sibling 导航 / admin 列表都用这个。 */
  async findByTopic(topicId: string, limit?: number): Promise<DigestReport[]> {
    let q = this.model.find({ topicId }).sort({ publishedAt: -1 });
    if (limit !== undefined) q = q.limit(limit);
    return q.exec();
  }

  async countByTopic(topicId: string): Promise<number> {
    return this.model.countDocuments({ topicId }).exec();
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: id }).exec();
  }
}
