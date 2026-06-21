/**
 * DigestPublicService — 公开端(无鉴权)报告读取业务层。
 *
 * 重构 Phase 1:报告本身改为 DigestReport entity,不再走 ContentItem/NavNode/snapshot 三表拼接。
 *   - report.markdown / findings / publishedAt / headline 全在 DigestReport 一张表
 *   - topic 仍然是 ContentItem(Phase 2 再动)——name / description 还从 ContentItem 取
 *   - siblings 从 DigestReportRepository.findByTopic 直接取,按 publishedAt 排
 *
 * 404 场景:
 *   - topicId 对应的 ContentItem 不存在
 *   - reportId 对应的 DigestReport 不存在
 *   - report.topicId !== 请求的 topicId(防止跨 topic 读取)
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ContentRepository } from '../content/content.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import { DigestReportRepository } from './digest-report.repository';
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
    private readonly navigationRepository: NavigationRepository,
    private readonly digestReportRepository: DigestReportRepository,
  ) {}

  async getReport(topicId: string, reportId: string): Promise<PublicReportDto> {
    const topicContent = await this.contentRepository.findById(topicId);
    if (!topicContent) {
      throw new NotFoundException(`事项不存在: ${topicId}`);
    }

    const report = await this.digestReportRepository.findById(reportId);
    if (!report) {
      throw new NotFoundException(`报告不存在: ${reportId}`);
    }
    if (report.topicId !== topicId) {
      throw new NotFoundException(`报告 ${reportId} 不属于事项 ${topicId}`);
    }

    const findings: PublicFindingDto[] = (report.findings ?? []).map((f) => ({
      citationId: f.citationId,
      title: f.title,
      url: f.url,
      sourceName: f.sourceName,
      publishedAt: f.publishedAt ? f.publishedAt.toISOString() : null,
      // reason / snippet 透传给 Aurora sub-agent context;前端 margin 列表不渲染
      reason: f.reason || undefined,
      snippet: f.snippet || undefined,
    }));

    // siblings = 同 topic 所有报告。按 publishedAt 升序(期号小→大),跟前端 prev/next 一致
    const siblingReports =
      await this.digestReportRepository.findByTopic(topicId);
    const siblings: PublicSiblingDto[] = siblingReports
      .map((r) => ({
        id: r._id,
        headline: r.headline,
        publishedAt: r.publishedAt.toISOString(),
      }))
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
        id: report._id,
        headline: report.headline,
        markdown: report.markdown,
        findings,
        publishedAt: report.publishedAt.toISOString(),
      },
      siblings,
    };
  }

  /**
   * 列出所有 digest 事项(公开目录页 /digest 使用)。
   * topic 仍然是 NavNode + ContentItem(Phase 2 再动),reports 已从 DigestReport 读。
   */
  async listTopics(): Promise<PublicTopicDto[]> {
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

      const reports = await this.digestReportRepository.findByTopic(
        node.contentItemId,
      );

      results.push({
        id: node.contentItemId,
        name: topicContent.latestVersion?.title ?? '',
        description: topicContent.latestVersion?.summary ?? '',
        reports: reports.map((r) => ({
          id: r._id,
          headline: r.headline,
          summary: r.markdown.slice(0, 200),
          publishedAt: r.publishedAt.toISOString(),
        })),
      });
    }

    // 逆序(最新创建的 topic 排最前)
    return results.reverse();
  }

  /**
   * 读事项信息 + 报告列表,供专栏首页(/digest/:topicId)使用。
   */
  async getTopic(topicId: string): Promise<PublicTopicDto> {
    const topicContent = await this.contentRepository.findById(topicId);
    if (!topicContent) {
      throw new NotFoundException(`事项不存在: ${topicId}`);
    }

    const reports = await this.digestReportRepository.findByTopic(topicId);
    this.logger.debug(`getTopic: topicId=${topicId} reports=${reports.length}`);

    return {
      id: topicId,
      name: topicContent.latestVersion?.title ?? '',
      description: topicContent.latestVersion?.summary ?? '',
      reports: reports.map((r) => ({
        id: r._id,
        headline: r.headline,
        summary: r.markdown.slice(0, 200),
        publishedAt: r.publishedAt.toISOString(),
      })),
    };
  }
}
