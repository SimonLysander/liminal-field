/**
 * CommitNode — 工作流第 3 节点：把报告入库、写导航树、写 ProcessedFeedItem 去重记录。
 *
 * 步骤（严格有序）：
 * 1. 找事项容器对应的 NavigationNode（parentNode）
 * 2. 构建完整 markdown（报告正文 + 参考资料列表）
 * 3. ContentService.createContent → ContentItem
 * 4. 在 digest scope 下创建子 NavigationNode（报告 entry）
 * 5. ContentService.saveContent commit（写 Git 归档 + snapshot）
 * 6. ProcessedFeedItemRepository.create × findings.length（去重记录）
 * 7. return { reportContentItemId }
 *
 * 设计决策：
 * - 不动 workflow service 层的 DigestTask 状态——由 DigestWorkflowService 统一管理。
 * - buildReferences 把 findings 转成 markdown 参考资料列表，追加在报告末尾。
 * - ProcessedFeedItem 写法：topicId + sourceId + itemGuid（唯一索引去重基准）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
// import type 用于 @Injectable 构造器参数会导致 NestJS IoC 运行时无法解析，改为正式 import
import { ContentService } from '../../../content/content.service';
import { ContentStatus } from '../../../content/content-item.entity';
import { ContentSaveAction } from '../../../content/dto/save-content.dto';
import { NavigationRepository } from '../../../navigation/navigation.repository';
import { NavigationScope } from '../../../navigation/navigation.entity';
import { ProcessedFeedItemRepository } from '../../processed-feed-item.repository';
import type { DigestTask, Finding } from '../../digest-task.entity'; // 非注入参数，保留 type import
import type { ComposeOutput } from './compose.node'; // 非注入参数，保留 type import

export interface CommitInput {
  topicId: string;
  taskId: string;
  headline: string;
  markdown: string;
  findings: Finding[];
}

export interface CommitOutput {
  reportContentItemId: string;
}

function buildPfiId(): string {
  return `pfi_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function buildReferences(findings: Finding[]): string {
  if (findings.length === 0) return '';
  const lines = findings.map(
    (f) =>
      `[CIT ${f.citationId}] [${f.title}](${f.url})` +
      (f.sourceName ? ` — ${f.sourceName}` : '') +
      (f.publishedAt ? ` (${f.publishedAt.toISOString().slice(0, 10)})` : ''),
  );
  return `## 参考资料\n\n${lines.join('\n')}`;
}

@Injectable()
export class CommitNode {
  private readonly logger = new Logger(CommitNode.name);

  constructor(
    private readonly contentService: ContentService,
    private readonly navigationRepo: NavigationRepository,
    private readonly pfiRepo: ProcessedFeedItemRepository,
  ) {}

  async run(task: DigestTask, compose: ComposeOutput): Promise<CommitOutput> {
    const { topicId, _id: taskId, findings } = task;
    const { headline, markdown } = compose;

    this.logger.log(
      `[commit] 开始 taskId=${taskId} topicId=${topicId} headline="${headline}"`,
    );

    // 1. 找事项容器对应的 NavigationNode（parentNode）
    const parentNode = await this.navigationRepo.findByContentItemId(topicId);

    // 2. 构建完整 markdown（报告正文 + 参考资料）
    const refs = buildReferences(findings);
    const fullMarkdown = refs ? `${markdown}\n\n---\n\n${refs}` : markdown;

    // 3. 创建 ContentItem
    const ci = await this.contentService.createContent({
      title: headline,
      summary: markdown.slice(0, 200),
      createdBy: 'digest-workflow',
    });

    // 4. 创建子 NavigationNode（digest scope，挂在事项容器下）
    const parentId = parentNode ? parentNode._id.toString() : undefined;
    const siblings = parentId
      ? await this.navigationRepo.listByParentId(
          parentId,
          NavigationScope.digest,
        )
      : [];

    await this.navigationRepo.create({
      scope: NavigationScope.digest,
      parentId,
      contentItemId: ci.id,
      name: headline,
      order: siblings.length,
    });

    // 5. saveContent commit（写 Git 归档 + snapshot）
    await this.contentService.saveContent(ci.id, {
      title: headline,
      summary: markdown.slice(0, 200),
      status: ContentStatus.committed,
      bodyMarkdown: fullMarkdown,
      changeNote: '智能采集自动生成',
      action: ContentSaveAction.commit,
      source: 'digest',
    });

    // 6. 写 ProcessedFeedItem（去重记录），忽略重复键错误（幂等）
    const pickedAt = new Date();
    const pfiWrites = findings.map((f) =>
      this.pfiRepo
        .create({
          _id: buildPfiId(),
          topicId,
          sourceId: f.sourceId,
          itemGuid: f.itemGuid,
          title: f.title,
          url: f.url,
          pickedAt,
          reportContentItemId: ci.id,
        })
        .catch((err: unknown) => {
          // 唯一索引冲突（重复运行）→ 记 warn 不 throw，保证幂等
          this.logger.warn(
            `commit: pfi 写入跳过重复 itemGuid=${f.itemGuid}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
    );
    await Promise.all(pfiWrites);

    this.logger.log(
      `[commit] 完成 taskId=${taskId} reportContentItemId=${ci.id} findings=${findings.length}`,
    );

    return { reportContentItemId: ci.id };
  }
}
