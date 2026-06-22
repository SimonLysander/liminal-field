/**
 * CommitNode — 工作流第 3 节点:把报告入库 + 写 ProcessedFeedItem 去重记录。
 *
 * 重构(Phase 1):不再走 ContentService/NavigationService —— digest 报告独立 entity。
 * 笔记/文集 ContentItem 那套(git 归档 / publishedVersion 状态机 / NavNode 树)对 AI
 * 量产的 snapshot 完全错配,每个 hook 都要打补丁。改为直接写 DigestReport 一张表。
 *
 * 步骤:
 *   1. computePeriodKey(按 stc.cron 推断周期粒度)→ 本期 periodKey
 *   2. DigestReportRepository.upsertByPeriod:同 (topicId, periodKey) 硬覆盖、否则新建 dr_xxx
 *      —— 实现「一期一条、同周期重复生成覆盖旧的」(返回文档 _id 才是真实 id)
 *   3. ProcessedFeedItemRepository.create × findings.length(去重记录)
 *   4. return { reportContentItemId }(供 workflow service 回写 task.reportContentItemId)
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
import type { DigestTask } from '../../digest-task.entity';
import type { ComposeOutput } from './compose.node';
import { SmartTopicConfigRepository } from '../../smart-topic-config.repository';
// 按 stc.cron 推断本期周期标识 periodKey,实现"同周期 upsert 硬覆盖"
import { computePeriodKey } from '../../period.util';

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
    // 算 periodKey 需要 stc.cron(周期粒度由 cron 推断)
    private readonly stcRepo: SmartTopicConfigRepository,
  ) {}

  async run(task: DigestTask, compose: ComposeOutput): Promise<CommitOutput> {
    const { topicId, _id: taskId, findings } = task;
    const { headline, deck, markdown } = compose;

    this.logger.log(
      `[commit] 开始 taskId=${taskId} topicId=${topicId} headline="${headline}"`,
    );

    const publishedAt = new Date();
    // 本期周期标识:同一周期(日/周/月,按 cron 推断)内重复生成对齐到同一 periodKey
    const stc = await this.stcRepo.findByContentItemId(topicId);
    const periodKey = computePeriodKey(stc?.cron, publishedAt);

    // upsertByPeriod:同 (topicId, periodKey) 已存在则硬覆盖(沿用旧 _id,URL 稳定),否则新建。
    // 返回文档的 _id 才是真实 id(覆盖时是旧 id),后续 pfi / task 回写都用它。
    const report = await this.digestReportRepo.upsertByPeriod({
      _id: buildReportId(),
      topicId,
      periodKey,
      taskId,
      headline,
      deck,
      markdown,
      findings,
      publishedAt,
    });
    const reportId = report._id;

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
      `[commit] 完成 taskId=${taskId} reportId=${reportId} periodKey=${periodKey} findings=${findings.length}`,
    );

    return { reportContentItemId: reportId };
  }
}
