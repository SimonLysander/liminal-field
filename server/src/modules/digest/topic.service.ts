/**
 * TopicService — 智能采集事项 CRUD 业务层。
 *
 * 「事项」= 三件套原子绑定：
 *   1. NavigationNode (scope='digest', parentId=null) — 顶级容器
 *   2. ContentItem (ci_xxx) — 标题=事项名，bodyMarkdown=卷首语
 *   3. SmartTopicConfig (stc_xxx) — cron / sourceIds / keywords / prompt / enabled
 *
 * 操作原则（first iteration）：
 *   - 不用 transaction，顺序操作 + try/catch + best-effort 清理
 *   - 失败时 logger.error，不隐藏错误
 *   - update name 同步 NavigationNode.name（同 workspace.service 同款）
 *   - delete 先删子节点（报告），再删三件套
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import { ContentService } from '../content/content.service';
import { ContentRepository } from '../content/content.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import { NavigationScope } from '../navigation/navigation.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';
import { InfoSourceRepository } from './info-source.repository';
import {
  CreateTopicDto,
  isValidCronFormat,
} from './dto/smart-topic-config.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';
import type { TopicSummaryDto, TopicDetailDto } from './dto/topic-view.dto';
import { RunStatus } from './smart-topic-config.entity';
// import type 会导致运行时 metadata 丢失（NestJS IoC 无法注入）— 必须用 import（非 type）
import { DigestSchedulerService } from './digest-scheduler.service';

@Injectable()
export class TopicService {
  private readonly logger = new Logger(TopicService.name);

  constructor(
    private readonly contentService: ContentService,
    private readonly contentRepository: ContentRepository,
    private readonly navigationRepository: NavigationRepository,
    private readonly smartTopicConfigRepository: SmartTopicConfigRepository,
    private readonly infoSourceRepository: InfoSourceRepository,
    // 注入 DigestSchedulerService 用于 create/update/delete 后同步调度状态
    private readonly scheduler: DigestSchedulerService,
  ) {}

  /** 生成事项配置业务 id，格式 stc_xxx，同款风格 */
  private buildConfigId(): string {
    return `stc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  /** 校验 cron 格式 */
  private validateCron(cron: string): void {
    if (!isValidCronFormat(cron)) {
      throw new BadRequestException(
        `cron 格式不合法，需五段式（如 '0 8 * * *'）`,
      );
    }
  }

  /** 校验 sourceIds 全部存在 */
  private async validateSourceIds(sourceIds: string[]): Promise<void> {
    if (sourceIds.length === 0) return;
    const found = await this.infoSourceRepository.findManyByIds(sourceIds);
    if (found.length !== sourceIds.length) {
      const foundIds = new Set(found.map((s) => String(s._id)));
      const missing = sourceIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`以下信息源不存在：${missing.join(', ')}`);
    }
  }

  async list(): Promise<TopicSummaryDto[]> {
    // 取所有 digest scope 顶级节点
    const rootNodes = await this.navigationRepository.findRootNodes(
      NavigationScope.digest,
    );

    const result: TopicSummaryDto[] = [];
    for (const node of rootNodes) {
      if (!node.contentItemId) continue;

      const config = await this.smartTopicConfigRepository.findByContentItemId(
        node.contentItemId,
      );
      // 数据不一致时跳过（三件套缺一），记日志
      if (!config) {
        this.logger.warn(
          `list: NavNode ${String(node._id)} 无对应 SmartTopicConfig，跳过 contentItemId=${node.contentItemId}`,
        );
        continue;
      }

      // 统计子节点数（报告）
      const children = await this.navigationRepository.findChildrenByParentId(
        String(node._id),
      );

      result.push({
        id: node.contentItemId,
        name: node.name,
        cron: config.cron,
        sourceCount: config.sourceIds.length,
        keywordCount: config.keywords.length,
        enabled: config.enabled,
        reportCount: children.length,
        lastRunAt: config.lastRunAt ? config.lastRunAt.toISOString() : null,
        lastRunHits: 0, // task #36 工作流才填充
        lastRunStatus: config.lastRunStatus
          ? config.lastRunStatus === RunStatus.ok
            ? 'ok'
            : 'failed'
          : null,
      });
    }

    // 按创建时间倒序（以 NavigationNode createdAt 代理）
    return result.reverse();
  }

  async getById(contentItemId: string): Promise<TopicDetailDto> {
    const navNode =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (!navNode || navNode.scope !== NavigationScope.digest) {
      throw new NotFoundException(`Topic not found: ${contentItemId}`);
    }

    const contentItem = await this.contentRepository.findById(contentItemId);
    if (!contentItem) {
      throw new NotFoundException(
        `ContentItem not found for topic: ${contentItemId}`,
      );
    }

    const config =
      await this.smartTopicConfigRepository.findByContentItemId(contentItemId);
    if (!config) {
      throw new NotFoundException(
        `SmartTopicConfig not found for topic: ${contentItemId}`,
      );
    }

    // join InfoSource 拿名字回显
    const sources = await this.infoSourceRepository.findManyByIds(
      config.sourceIds,
    );
    const sourceRefs = sources.map((s) => ({
      id: String(s._id),
      name: s.name,
      type: s.type,
    }));

    // 子节点数（报告数）
    const children = await this.navigationRepository.findChildrenByParentId(
      String(navNode._id),
    );

    // ContentItem 的卷首语存在 latestVersion 的 summary 里（简单方式），
    // 但实际上事项描述用 ContentItem 的 latestVersion.summary（创建时传入 description）
    const description = contentItem.latestVersion?.summary ?? '';

    return {
      id: contentItemId,
      name: navNode.name,
      description,
      cron: config.cron,
      sourceIds: config.sourceIds,
      sources: sourceRefs,
      keywords: config.keywords,
      prompt: config.prompt,
      enabled: config.enabled,
      // maxSteps 由 schema default 20 兜底，老数据回落 20
      maxSteps: config.maxSteps ?? 20,
      reportCount: children.length,
      lastRunAt: config.lastRunAt ? config.lastRunAt.toISOString() : null,
      lastRunStatus: config.lastRunStatus
        ? config.lastRunStatus === RunStatus.ok
          ? 'ok'
          : 'failed'
        : null,
      lastRunError: config.lastRunError ?? null,
      createdAt: contentItem.createdAt.toISOString(),
      updatedAt: contentItem.updatedAt
        ? contentItem.updatedAt.toISOString()
        : null,
    };
  }

  async create(
    dto: CreateTopicDto & { description?: string },
  ): Promise<TopicDetailDto> {
    this.validateCron(dto.cron);
    await this.validateSourceIds(dto.sourceIds);

    this.logger.log(`creating topic name=${dto.name} cron=${dto.cron}`);

    // 1. 建 ContentItem（createContent 只建 MongoDB 记录，title=事项名，summary=描述）
    let contentDetail: { id: string };
    try {
      contentDetail = await this.contentService.createContent({
        title: dto.name,
        summary: dto.description ?? '',
      });
    } catch (err) {
      this.logger.error(`create topic: createContent 失败`, err);
      throw err;
    }
    const contentItemId = contentDetail.id;

    // 2. 建 NavigationNode（scope=digest, parentId=null, 顶级容器）
    const siblings = await this.navigationRepository.findRootNodes(
      NavigationScope.digest,
    );
    try {
      await this.navigationRepository.create({
        name: dto.name,
        scope: NavigationScope.digest,
        contentItemId,
        order: siblings.length,
      });
    } catch (err) {
      // task #35 first iteration: 不用 transaction，失败时手动清理可能有残留
      this.logger.error(
        `create topic: navigationRepository.create 失败，contentItemId=${contentItemId}，尝试清理 ContentItem`,
        err,
      );
      await this.contentRepository
        .deleteById(contentItemId)
        .catch((e) =>
          this.logger.error(`清理 ContentItem ${contentItemId} 失败`, e),
        );
      throw err;
    }

    // 3. 建 SmartTopicConfig
    const configId = this.buildConfigId();
    try {
      await this.smartTopicConfigRepository.create({
        _id: configId,
        contentItemId,
        cron: dto.cron,
        sourceIds: dto.sourceIds,
        keywords: dto.keywords,
        prompt: dto.prompt,
        enabled: dto.enabled ?? true,
        // maxSteps 缺省时不传，让 schema default(20) 兜底
        ...(dto.maxSteps !== undefined ? { maxSteps: dto.maxSteps } : {}),
      });
    } catch (err) {
      // task #35 first iteration: 不用 transaction，失败时手动清理可能有残留
      this.logger.error(
        `create topic: SmartTopicConfig.create 失败，尝试清理 NavNode + ContentItem`,
        err,
      );
      const navNode =
        await this.navigationRepository.findByContentItemId(contentItemId);
      if (navNode) {
        await this.navigationRepository
          .deleteById(String(navNode._id))
          .catch((e) => this.logger.error(`清理 NavNode 失败`, e));
      }
      await this.contentRepository
        .deleteById(contentItemId)
        .catch((e) =>
          this.logger.error(`清理 ContentItem ${contentItemId} 失败`, e),
        );
      throw err;
    }

    this.logger.log(
      `topic created: contentItemId=${contentItemId} configId=${configId}`,
    );

    // 钩接调度器：创建后立即按 enabled 状态注册（或跳过）cron job
    const newConfig =
      await this.smartTopicConfigRepository.findByContentItemId(contentItemId);
    if (newConfig) {
      this.scheduler.reschedule(newConfig);
    }

    return this.getById(contentItemId);
  }

  async update(
    contentItemId: string,
    dto: UpdateTopicDto,
  ): Promise<TopicDetailDto> {
    // 确保事项存在
    const navNode =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (!navNode || navNode.scope !== NavigationScope.digest) {
      throw new NotFoundException(`Topic not found: ${contentItemId}`);
    }

    const config =
      await this.smartTopicConfigRepository.findByContentItemId(contentItemId);
    if (!config) {
      throw new NotFoundException(
        `SmartTopicConfig not found for topic: ${contentItemId}`,
      );
    }

    // 校验 cron / sourceIds（如有变更）
    if (dto.cron !== undefined) this.validateCron(dto.cron);
    if (dto.sourceIds !== undefined)
      await this.validateSourceIds(dto.sourceIds);

    // 更新 name：同步 NavigationNode.name + ContentItem.title（同 workspace.service.update 同款）
    if (dto.name !== undefined) {
      await this.contentRepository.patchMeta(contentItemId, {
        title: dto.name,
        summary: dto.description,
      });
      await this.navigationRepository.update(String(navNode._id), {
        name: dto.name,
      });
    } else if (dto.description !== undefined) {
      // 只改描述时仅 patch summary
      await this.contentRepository.patchMeta(contentItemId, {
        summary: dto.description,
      });
    }

    // 更新 SmartTopicConfig（只传有值的字段）
    const configPatch: {
      cron?: string;
      sourceIds?: string[];
      keywords?: string[];
      prompt?: string;
      enabled?: boolean;
      maxSteps?: number;
    } = {};
    if (dto.cron !== undefined) configPatch.cron = dto.cron;
    if (dto.sourceIds !== undefined) configPatch.sourceIds = dto.sourceIds;
    if (dto.keywords !== undefined) configPatch.keywords = dto.keywords;
    if (dto.prompt !== undefined) configPatch.prompt = dto.prompt;
    if (dto.enabled !== undefined) configPatch.enabled = dto.enabled;
    if (dto.maxSteps !== undefined) configPatch.maxSteps = dto.maxSteps;

    if (Object.keys(configPatch).length > 0) {
      await this.smartTopicConfigRepository.update(
        String(config._id),
        configPatch,
      );
    }

    this.logger.log(`topic updated: contentItemId=${contentItemId}`);

    // 钩接调度器：任何配置变更（cron / enabled）都要重新同步调度
    const updatedConfig =
      await this.smartTopicConfigRepository.findByContentItemId(contentItemId);
    if (updatedConfig) {
      this.scheduler.reschedule(updatedConfig);
    }

    return this.getById(contentItemId);
  }

  async delete(contentItemId: string): Promise<void> {
    const navNode =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (!navNode) {
      throw new NotFoundException(`Topic not found: ${contentItemId}`);
    }

    // 钩接调度器：删除前先注销 cron job，防止删除后还触发工作流
    this.scheduler.unregisterJob(contentItemId);

    // 1. 级联删除子节点（报告）：报告 = 该 NavigationNode 下的子节点
    const children = await this.navigationRepository.findChildrenByParentId(
      String(navNode._id),
    );
    for (const child of children) {
      try {
        if (child.contentItemId) {
          await this.contentRepository.deleteById(child.contentItemId);
        }
        await this.navigationRepository.deleteById(String(child._id));
      } catch (err) {
        // best-effort 删除子节点，失败记日志但继续
        this.logger.error(
          `delete topic: 删除子节点 ${String(child._id)} 失败（best-effort）`,
          err,
        );
      }
    }

    // 2. 删 SmartTopicConfig
    try {
      await this.smartTopicConfigRepository.deleteByContentItemId(
        contentItemId,
      );
    } catch (err) {
      this.logger.error(
        `delete topic: deleteByContentItemId 失败 contentItemId=${contentItemId}`,
        err,
      );
    }

    // 3. 删顶级 NavigationNode
    try {
      await this.navigationRepository.deleteById(String(navNode._id));
    } catch (err) {
      this.logger.error(
        `delete topic: 删除 NavNode ${String(navNode._id)} 失败`,
        err,
      );
    }

    // 4. 删顶级 ContentItem
    try {
      await this.contentRepository.deleteById(contentItemId);
    } catch (err) {
      this.logger.error(
        `delete topic: 删除 ContentItem ${contentItemId} 失败`,
        err,
      );
    }

    this.logger.log(`topic deleted: contentItemId=${contentItemId}`);
  }
}
