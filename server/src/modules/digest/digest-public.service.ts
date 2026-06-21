/**
 * DigestPublicService — 公开端（无鉴权）报告读取业务层。
 *
 * 数据来源组合：
 *   - topic（事项）：ContentRepository.findById(topicId) + SmartTopicConfigRepository
 *   - report（报告）：ContentRepository.findById(reportId) + ContentSnapshotRepository（读 markdown）
 *   - findings（参考资料）：DigestTaskRepository 反查 reportContentItemId=reportId 的最新 done task
 *   - siblings（同专栏其他期）：通过 NavigationRepository 查 topicId 下所有子节点
 *
 * 设计约束（task #52）：
 *   - 报告一旦 commit 就视为公开，无需 published 状态过滤
 *   - 不暴露内部字段（traceId / iterations / llmCallsCount）
 *   - 读 markdown 优先走 latestVersion.versionId 对应的 snapshot，不走 Git 磁盘
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import { DigestTaskRepository } from './digest-task.repository';
import { DigestTaskStatus } from './digest-task.entity';
import { NavigationScope } from '../navigation/navigation.entity';
import type {
  PublicReportDto,
  PublicTopicDto,
  PublicSiblingDto,
  PublicFindingDto,
} from './dto/digest-public.dto';

@Injectable()
export class DigestPublicService {
  private readonly logger = new Logger(DigestPublicService.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly navigationRepository: NavigationRepository,
    private readonly digestTaskRepository: DigestTaskRepository,
  ) {}

  /**
   * 读单个报告及其 topic 上下文、findings、siblings。
   *
   * 404 场景：
   *   - topicId 对应的 ContentItem 不存在
   *   - reportId 对应的 ContentItem 不存在
   *   - reportId 的 NavigationNode 不在 topicId 的子节点列表中（防止跨 topic 读取）
   */
  async getReport(topicId: string, reportId: string): Promise<PublicReportDto> {
    // ── 1. 校验 topic 存在 ──
    const topicContent = await this.contentRepository.findById(topicId);
    if (!topicContent) {
      throw new NotFoundException(`事项不存在: ${topicId}`);
    }

    // ── 2. 校验 report 存在 ──
    const reportContent = await this.contentRepository.findById(reportId);
    if (!reportContent) {
      throw new NotFoundException(`报告不存在: ${reportId}`);
    }

    // ── 3. 校验 reportId 确实是 topicId 的子节点（防止跨事项读取） ──
    // 找 topic 对应的 NavNode（scope=digest 的根节点）
    const topicNavNode =
      await this.navigationRepository.findByContentItemId(topicId);
    if (!topicNavNode || topicNavNode.scope !== NavigationScope.digest) {
      throw new NotFoundException(`事项不存在: ${topicId}`);
    }

    // 找 topic 下所有子节点（报告）
    const children = await this.navigationRepository.findChildrenByParentId(
      String(topicNavNode._id),
    );
    const childContentIds = children
      .map((c) => c.contentItemId)
      .filter((id): id is string => !!id);

    if (!childContentIds.includes(reportId)) {
      throw new NotFoundException(`报告 ${reportId} 不属于事项 ${topicId}`);
    }

    // ── 4. 读报告 markdown（从最新 snapshot） ──
    const versionId = reportContent.latestVersion?.versionId;
    let markdown = '';
    if (versionId) {
      const snapshot = await this.snapshotRepository.findByVersionId(versionId);
      markdown = snapshot?.bodyMarkdown ?? '';
    } else {
      this.logger.warn(
        `report ${reportId} 无 latestVersion.versionId，markdown 返回空`,
      );
    }

    // ── 5. 从最近一次 done task 拿 findings ──
    const tasks = await this.digestTaskRepository.findRecentByTopic(
      topicId,
      50,
    );
    // 找 reportContentItemId 匹配的最新 done task
    const matchedTask = tasks.find(
      (t) =>
        t.reportContentItemId === reportId &&
        t.status === DigestTaskStatus.done,
    );
    const findings: PublicFindingDto[] = (matchedTask?.findings ?? []).map(
      (f) => ({
        citationId: f.citationId,
        title: f.title,
        url: f.url,
        sourceName: f.sourceName,
        publishedAt: f.publishedAt ? f.publishedAt.toISOString() : null,
        // reason + snippet 透传给前端 → 注入 Aurora sub-agent context,让追问能基于
        // 完整摘要回答(不再只看到标题"摘要里没说")。前端 margin 列表不渲染这两字段。
        reason: f.reason || undefined,
        snippet: f.snippet || undefined,
      }),
    );

    // ── 6. 构建 siblings（同 topic 所有报告，按 NavNode 顺序排序） ──
    // 批量查 ContentItem
    const siblingContents = await Promise.all(
      childContentIds.map((id) => this.contentRepository.findById(id)),
    );
    const siblings: PublicSiblingDto[] = siblingContents
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map((c) => ({
        id: c.id,
        headline: c.latestVersion?.title ?? '',
        publishedAt: c.createdAt.toISOString(),
      }))
      // 按发布时间升序（期号从小到大），与前端 prev/next 逻辑一致
      .sort(
        (a, b) =>
          new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
      );

    this.logger.debug(
      `getReport: topicId=${topicId} reportId=${reportId} findings=${findings.length} siblings=${siblings.length}`,
    );

    return {
      topic: {
        id: topicId,
        name: topicContent.latestVersion?.title ?? '',
        description: topicContent.latestVersion?.summary ?? '',
      },
      report: {
        id: reportId,
        headline: reportContent.latestVersion?.title ?? '',
        markdown,
        findings,
        publishedAt: reportContent.createdAt.toISOString(),
      },
      siblings,
    };
  }

  /**
   * 列出所有 digest 事项（公开目录页 /digest 使用）。
   * 不鉴权，任何人可读——只返回展示所需的最小字段。
   */
  async listTopics(): Promise<PublicTopicDto[]> {
    // 取所有 digest scope 顶级节点
    const rootNodes = await this.navigationRepository.findRootNodes(
      NavigationScope.digest,
    );

    const results: PublicTopicDto[] = [];
    for (const node of rootNodes) {
      if (!node.contentItemId) continue;

      const topicContent = await this.contentRepository.findById(
        node.contentItemId,
      );
      if (!topicContent) continue;

      // 子节点（报告列表）
      const children = await this.navigationRepository.findChildrenByParentId(
        String(node._id),
      );
      const childContentIds = children
        .map((c) => c.contentItemId)
        .filter((id): id is string => !!id);

      const reportContents = (
        await Promise.all(
          childContentIds.map((id) => this.contentRepository.findById(id)),
        )
      )
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

      results.push({
        id: node.contentItemId,
        name: topicContent.latestVersion?.title ?? '',
        description: topicContent.latestVersion?.summary ?? '',
        reports: reportContents.map((c) => ({
          id: c.id,
          headline: c.latestVersion?.title ?? '',
          summary: c.latestVersion?.summary ?? '',
          publishedAt: c.createdAt.toISOString(),
        })),
      });
    }

    // 逆序（最新创建的 topic 排在最前）
    return results.reverse();
  }

  /**
   * 读事项信息 + 最近报告列表，供专栏首页（/digest/:topicId）使用。
   */
  async getTopic(topicId: string): Promise<PublicTopicDto> {
    const topicContent = await this.contentRepository.findById(topicId);
    if (!topicContent) {
      throw new NotFoundException(`事项不存在: ${topicId}`);
    }

    const topicNavNode =
      await this.navigationRepository.findByContentItemId(topicId);
    if (!topicNavNode || topicNavNode.scope !== NavigationScope.digest) {
      throw new NotFoundException(`事项不存在: ${topicId}`);
    }

    // 所有子节点（报告）
    const children = await this.navigationRepository.findChildrenByParentId(
      String(topicNavNode._id),
    );
    const childContentIds = children
      .map((c) => c.contentItemId)
      .filter((id): id is string => !!id);

    // 批量查报告 ContentItem，按创建时间倒序排列（最新在前）
    const reportContents = (
      await Promise.all(
        childContentIds.map((id) => this.contentRepository.findById(id)),
      )
    )
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    const reports = reportContents.map((c) => ({
      id: c.id,
      headline: c.latestVersion?.title ?? '',
      summary: c.latestVersion?.summary ?? '',
      publishedAt: c.createdAt.toISOString(),
    }));

    this.logger.debug(`getTopic: topicId=${topicId} reports=${reports.length}`);

    return {
      id: topicId,
      name: topicContent.latestVersion?.title ?? '',
      description: topicContent.latestVersion?.summary ?? '',
      reports,
    };
  }
}
