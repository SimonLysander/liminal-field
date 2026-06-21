/**
 * CommitNode — 工作流第 3 节点:把报告入库 + 写 ProcessedFeedItem 去重记录。
 *
 * 重构(Phase 1):不再走 ContentService/NavigationService —— digest 报告独立 entity。
 * 笔记/文集 ContentItem 那套(git 归档 / publishedVersion 状态机 / NavNode 树)对 AI
 * 量产的 snapshot 完全错配,每个 hook 都要打补丁。改为直接写 DigestReport 一张表。
 *
 * 步骤:
 *   1. 生成 dr_xxx id
 *   2. DigestReportRepository.create(headline, markdown, findings, publishedAt, topicId, taskId)
 *   3. ProcessedFeedItemRepository.create × findings.length(去重记录)
 *   4. return { reportId }(供 workflow service 回写 task.reportContentItemId)
 *
 * 设计决策:
 * - reportId 沿用 ci_ prefix→ dr_xxx 新前缀(干净);老数据迁移由 DigestModule.onModuleInit 处理
 * - findings 直接存进 DigestReport(独立副本),跟 DigestTask.findings 解耦——
 *   即使 task 记录将来归档/清理,报告本身仍可读
 * - ProcessedFeedItem.reportContentItemId 字段保留名(语义改成 reportId,值现在是 dr_xxx)
 *   避免改库 schema
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import { DigestReportRepository } from '../../digest-report.repository';
import type { DigestTask, Finding } from '../../digest-task.entity';
import type { ComposeOutput } from './compose.node';

export interface CommitInput {
  topicId: string;
  taskId: string;
  headline: string;
  markdown: string;
  findings: Finding[];
}

export interface CommitOutput {
  /** DigestReport._id (dr_xxx);workflow service 回写 task.reportContentItemId 沿用旧字段名 */
  reportContentItemId: string;
}

function buildPfiId(): string {
  return `pfi_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function buildReportId(): string {
  return `dr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

@Injectable()
export class CommitNode {
  private readonly logger = new Logger(CommitNode.name);

  constructor(
    private readonly digestReportRepo: DigestReportRepository,
    private readonly pfiRepo: ProcessedFeedItemRepository,
  ) {}

  async run(task: DigestTask, compose: ComposeOutput): Promise<CommitOutput> {
    const { topicId, _id: taskId, findings } = task;
    const { headline, deck, markdown } = compose;

    this.logger.log(
      `[commit] 开始 taskId=${taskId} topicId=${topicId} headline="${headline}"`,
    );

    const reportId = buildReportId();
    const publishedAt = new Date();

    await this.digestReportRepo.create({
      _id: reportId,
      topicId,
      taskId,
      headline,
      deck,
      markdown,
      findings,
      publishedAt,
    });

    // ProcessedFeedItem 去重记录,忽略重复键错误(幂等)
    const pfiWrites = findings.map((f) =>
      this.pfiRepo
        .create({
          _id: buildPfiId(),
          topicId,
          sourceId: f.sourceId,
          itemGuid: f.itemGuid,
          title: f.title,
          url: f.url,
          pickedAt: publishedAt,
          reportContentItemId: reportId,
        })
        .catch((err: unknown) => {
          // 唯一索引冲突(重复运行)→ 记 warn 不 throw,保证幂等
          this.logger.warn(
            `commit: pfi 写入跳过重复 itemGuid=${f.itemGuid}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
    );
    await Promise.all(pfiWrites);

    this.logger.log(
      `[commit] 完成 taskId=${taskId} reportId=${reportId} findings=${findings.length}`,
    );

    return { reportContentItemId: reportId };
  }
}
