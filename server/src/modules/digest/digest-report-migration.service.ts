/**
 * DigestReportMigrationService — 一次性迁移老的 ContentItem 时代的 digest 报告。
 *
 * 触发时机:onModuleInit。
 * 范围:扫所有 DigestTask 里 reportContentItemId 非空且对应 DigestReport 不存在的,
 *      从 ContentItem + 最新 ContentSnapshot 拷 markdown + headline + publishedAt,
 *      用旧 contentItemId 作 DigestReport._id(保持 URL 兼容)。
 *
 * 幂等:已存在的 DigestReport 跳过。第一次启动迁移,以后就什么都不做。
 *
 * 不删旧 ContentItem / NavNode:留在 mongo 作历史归档,管理员后续可手动清理。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { DigestTaskRepository } from './digest-task.repository';
import { DigestReportRepository } from './digest-report.repository';
import { DigestTaskStatus } from './digest-task.entity';

@Injectable()
export class DigestReportMigrationService implements OnModuleInit {
  private readonly logger = new Logger(DigestReportMigrationService.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly digestTaskRepository: DigestTaskRepository,
    private readonly digestReportRepository: DigestReportRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const migrated = await this.migrate();
      if (migrated > 0) {
        this.logger.log(`迁移完成:${migrated} 期老报告 → DigestReport`);
      } else {
        this.logger.debug('没有老报告需要迁移(全新部署或已迁移过)');
      }
    } catch (err) {
      // 迁移失败不阻塞启动 —— 老路径在新代码下不再被访问,新报告会以 dr_ 前缀创建
      this.logger.error(
        `迁移失败(不阻塞启动): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async migrate(): Promise<number> {
    // 扫所有有 reportContentItemId 的 done task —— 这就是老 ContentItem 时代的报告池
    const allDoneTasks = await this.digestTaskRepository.findAllDone();
    let count = 0;
    for (const task of allDoneTasks) {
      if (!task.reportContentItemId || task.status !== DigestTaskStatus.done) {
        continue;
      }
      const existing = await this.digestReportRepository.findById(
        task.reportContentItemId,
      );
      if (existing) continue;

      const content = await this.contentRepository.findById(
        task.reportContentItemId,
      );
      if (!content) {
        this.logger.warn(
          `迁移跳过 task=${task._id}:ContentItem ${task.reportContentItemId} 不存在`,
        );
        continue;
      }

      // markdown 从最新 snapshot 取
      const versionId = content.latestVersion?.versionId;
      let markdown = '';
      if (versionId) {
        const snapshot =
          await this.snapshotRepository.findByVersionId(versionId);
        markdown = snapshot?.bodyMarkdown ?? '';
      }

      await this.digestReportRepository.create({
        _id: task.reportContentItemId,
        topicId: task.topicId,
        taskId: task._id.toString(),
        headline: content.latestVersion?.title || task.reportSummary || '',
        markdown,
        findings: task.findings ?? [],
        publishedAt: content.createdAt,
      });
      count += 1;
    }
    return count;
  }
}
