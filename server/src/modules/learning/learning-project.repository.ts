import { Inject, Injectable } from '@nestjs/common';
import { getModelToken } from 'nestjs-typegoose';
import type { ReturnModelType } from '@typegoose/typegoose';
import { LearningProject } from './learning-project.entity';
import type { LearningProjectDto } from './dto/learning-project.dto';

@Injectable()
export class LearningProjectRepository {
  constructor(
    @Inject(getModelToken(LearningProject.name))
    private readonly model: ReturnModelType<typeof LearningProject>,
  ) {}

  private toDto(project: LearningProject): LearningProjectDto {
    return {
      id: project._id.toString(),
      rootNodeId: project.rootNodeId,
      rootContentItemId: project.rootContentItemId,
      status: project.status,
      createdAt: project.createdAt?.toISOString(),
      updatedAt: project.updatedAt?.toISOString(),
      archivedAt: project.archivedAt?.toISOString(),
    };
  }

  async createActive(input: {
    rootNodeId: string;
    rootContentItemId: string;
  }): Promise<LearningProjectDto> {
    const now = new Date();
    const project = await this.model.create({
      rootNodeId: input.rootNodeId,
      rootContentItemId: input.rootContentItemId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    return this.toDto(project);
  }

  async findById(id: string): Promise<LearningProjectDto | null> {
    const project = await this.model.findById(id);
    return project ? this.toDto(project) : null;
  }

  async findActiveByRootNodeIds(
    rootNodeIds: string[],
  ): Promise<LearningProjectDto[]> {
    if (rootNodeIds.length === 0) return [];
    const projects = await this.model.find({
      rootNodeId: { $in: rootNodeIds },
      status: 'active',
    });
    return projects.map((project) => this.toDto(project));
  }

  async archive(id: string): Promise<LearningProjectDto | null> {
    const now = new Date();
    const project = await this.model.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'archived',
          archivedAt: now,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    );
    return project ? this.toDto(project) : null;
  }

  async archiveActiveByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const now = new Date();
    await this.model.updateMany(
      { _id: { $in: ids }, status: 'active' },
      { $set: { status: 'archived', archivedAt: now, updatedAt: now } },
    );
  }

  /** 仅恢复本次删除前仍活动、且根节点仍存在的项目。 */
  async restoreActiveByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.model.updateMany(
      { _id: { $in: ids }, status: 'archived' },
      {
        $set: { status: 'active', updatedAt: new Date() },
        $unset: { archivedAt: '' },
      },
    );
  }
}
