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
import type { DigestReport } from './digest-report.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';
import { InfoSourceRepository } from './info-source.repository';
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
    // P3: sub-agent browse 工具需要知道本事项订阅了哪些源(id + name),从这两个 repo 拿
    private readonly smartTopicConfigRepo: SmartTopicConfigRepository,
    private readonly infoSourceRepo: InfoSourceRepository,
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

    // siblings = 同 topic 每期最新一份(展示端去重:同周期多次运行只给读者看最新)。
    // 按 publishedAt 升序(期号小→大),跟前端 prev/next 一致
    const siblingReports = latestPerPeriod(
      await this.digestReportRepository.findByTopic(topicId),
    );
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

    // 拿订阅源(供 Aurora sub-agent browse 工具用)。sub-agent 系统提示里会列出这些 src_xxx,
    // 模型从 prompt 看到后才能 browse 那个 sourceId。失败兜底空数组,功能优雅降级。
    let sources: { id: string; name: string }[] = [];
    try {
      const stc = await this.smartTopicConfigRepo.findByContentItemId(topicId);
      if (stc?.sourceIds?.length) {
        const sourceEntities = await this.infoSourceRepo.findManyByIds(
          stc.sourceIds,
        );
        // 过滤禁用源:agent 看见后会 browse 它 + 拿到"已禁用"错误,浪费 step 还误导
        sources = sourceEntities
          .filter((s) => s.enabled)
          .map((s) => ({
            id: String(s._id),
            name: s.name,
          }));
      }
    } catch (err) {
      this.logger.warn(
        `getReport: 拿 sources 失败(忽略,sub-agent 没源就只能用 web_search): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.logger.debug(
      `getReport: topicId=${topicId} reportId=${reportId} findings=${findings.length} siblings=${siblings.length} sources=${sources.length}`,
    );

    return {
      topic: {
        id: topicId,
        name: topicContent.latestVersion?.title ?? '',
        description: topicContent.latestVersion?.summary ?? '',
        sources,
      },
      report: {
        id: report._id,
        headline: report.headline,
        deck: report.deck,
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

      const reports = latestPerPeriod(
        await this.digestReportRepository.findByTopic(node.contentItemId),
      );

      // 拿 SmartTopicConfig 算 byline 用的 cadence + sourceCount
      const stc = await this.smartTopicConfigRepo.findByContentItemId(
        node.contentItemId,
      );

      results.push({
        id: node.contentItemId,
        name: topicContent.latestVersion?.title ?? '',
        description: topicContent.latestVersion?.summary ?? '',
        cadence: stc ? cronToHumanCadence(stc.cron) : undefined,
        sourceCount: stc?.sourceIds.length,
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

    const reports = latestPerPeriod(
      await this.digestReportRepository.findByTopic(topicId),
    );
    const stc = await this.smartTopicConfigRepo.findByContentItemId(topicId);
    this.logger.debug(`getTopic: topicId=${topicId} reports=${reports.length}`);

    return {
      id: topicId,
      name: topicContent.latestVersion?.title ?? '',
      description: topicContent.latestVersion?.summary ?? '',
      cadence: stc ? cronToHumanCadence(stc.cron) : undefined,
      sourceCount: stc?.sourceIds.length,
      reports: reports.map((r) => ({
        id: r._id,
        headline: r.headline,
        summary: r.markdown.slice(0, 200),
        publishedAt: r.publishedAt.toISOString(),
      })),
    };
  }
}

/**
 * 每个 periodKey 只保留最新一份(入参须已按 publishedAt 倒序,findByTopic 即如此)。
 * 展示端「每期一份」:同周期多次运行只给读者看最新那份,旧版留库但不展示。
 */
function latestPerPeriod(reports: DigestReport[]): DigestReport[] {
  const seen = new Set<string>();
  const out: DigestReport[] = [];
  for (const r of reports) {
    if (seen.has(r.periodKey)) continue;
    seen.add(r.periodKey);
    out.push(r);
  }
  return out;
}

/**
 * cron 表达式翻成人话 — 给报刊 byline 用("每天 08:00")。
 * 仅识别项目内常见三类:每天/每周/手动(空字符串当 manual 触发模式)。
 * 复杂表达式无解析时退化为原 cron 字符串(admin 自定义场景兜底)。
 */
function cronToHumanCadence(cron: string): string {
  if (!cron || cron.trim().length === 0) return '手动触发';
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [minute, hour, dayOfMonth, , dayOfWeek] = parts;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return cron;
  const hh = String(parseInt(hour, 10)).padStart(2, '0');
  const mm = String(parseInt(minute, 10)).padStart(2, '0');
  // 每周(0-6 单值)
  if (dayOfMonth === '*' && /^[0-6]$/.test(dayOfWeek)) {
    const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
      parseInt(dayOfWeek, 10)
    ];
    return `每${weekday} ${hh}:${mm}`;
  }
  // 每天
  if (dayOfMonth === '*' && dayOfWeek === '*') {
    return `每天 ${hh}:${mm}`;
  }
  return cron;
}
