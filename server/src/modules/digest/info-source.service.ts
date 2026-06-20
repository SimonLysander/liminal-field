/**
 * InfoSourceService — 信息源 CRUD 业务层。
 *
 * 首期只支持 type=rss，其他 type 在 service 层 BadRequest 拦截。
 * config.url 校验：必填且必须 https?:// 开头（防误填 feed:// 或裸域名）。
 *
 * 删除时检查 SmartTopicConfig 依赖（task #35）：
 *   若有事项订阅此源，拒绝删除，要求用户先取消订阅。
 *
 * onModuleInit（Task #40）：
 *   1. migrate 老数据：无 category 字段的文档批量补 'tech'。
 *   2. seed 内置源：首次启动时将 SEED_SOURCES 写入，已存在则跳过（幂等）。
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { InfoSourceRepository } from './info-source.repository';
import {
  InfoSource,
  InfoSourceType,
  InfoSourceCategory,
} from './info-source.entity';
import { SmartTopicConfigRepository } from './smart-topic-config.repository';
import { SEED_SOURCES, resolveSeedUrl } from './source-seeds';
import type {
  CreateInfoSourceDto,
  UpdateInfoSourceDto,
  InfoSourceDto,
} from './dto/info-source.dto';

const RSS_URL_RE = /^https?:\/\//;

@Injectable()
export class InfoSourceService implements OnModuleInit {
  private readonly logger = new Logger(InfoSourceService.name);

  constructor(
    private readonly repo: InfoSourceRepository,
    private readonly smartTopicConfigRepository: SmartTopicConfigRepository,
    @Inject(getModelToken(InfoSource.name))
    private readonly infoSourceModel: ReturnModelType<typeof InfoSource>,
  ) {}

  /**
   * 启动时 migrate + seed：
   * 1. 老数据没有 category 字段 → 批量补 'tech'（updateMany，幂等）。
   * 2. SEED_SOURCES 逐条按 name 查重，不存在则插入（不删用户已有的源）。
   */
  async onModuleInit(): Promise<void> {
    // ── Step 1: migrate 老数据 ──────────────────────────────────────────────
    const migrateResult = await this.infoSourceModel
      .updateMany(
        { category: { $exists: false } },
        { $set: { category: InfoSourceCategory.tech } },
      )
      .exec();
    if (migrateResult.modifiedCount > 0) {
      this.logger.log(
        `migrate: 补 category='tech' ${migrateResult.modifiedCount} 条老数据`,
      );
    }

    // ── Step 2: seed 内置源 ─────────────────────────────────────────────────
    let seededCount = 0;
    for (const seed of SEED_SOURCES) {
      const resolvedUrl = resolveSeedUrl(seed.rssUrl);
      // 以 name 做唯一性判断（同名即视为已存在，跳过；不以 URL 判断是因为 rsshub 占位符解析后可能因 env 变化而不同）
      const exists = await this.infoSourceModel
        .countDocuments({ name: seed.name })
        .exec();
      if (exists > 0) continue;

      await this.infoSourceModel.create({
        _id: `src_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        type: InfoSourceType.rss,
        name: seed.name,
        config: { url: resolvedUrl },
        category: seed.category,
        enabled: true,
        createdAt: new Date(),
      });
      seededCount++;
    }

    if (seededCount > 0) {
      this.logger.log(`seed: 新增内置信息源 ${seededCount} 条`);
    } else {
      this.logger.debug('seed: 所有内置源已存在，跳过');
    }
  }

  /** 构造业务 id，格式 src_xxx，跟 ci_xxx 同款风格 */
  private buildId(): string {
    return `src_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  /** entity → wire DTO（Date → ISO string，optional 字段统一 null） */
  private entityToDto(e: InfoSource): InfoSourceDto {
    return {
      id: String(e._id),
      type: e.type,
      name: e.name,
      config: e.config,
      enabled: e.enabled,
      lastFetchedAt: e.lastFetchedAt ? e.lastFetchedAt.toISOString() : null,
      lastFetchStatus: e.lastFetchStatus ?? null,
      lastFetchError: e.lastFetchError ?? null,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt ? e.updatedAt.toISOString() : null,
    };
  }

  /** 校验 type + config：目前只放行 rss，且 url 必须合法 */
  private validateType(
    type: InfoSourceType,
    config: Record<string, unknown>,
  ): void {
    if (type !== InfoSourceType.rss) {
      throw new BadRequestException('暂不支持的 type');
    }
    const url = config['url'];
    if (!url || typeof url !== 'string' || !RSS_URL_RE.test(url)) {
      throw new BadRequestException(
        'rss 信息源必须提供合法的 config.url（https?://…）',
      );
    }
  }

  async list(): Promise<InfoSourceDto[]> {
    const sources = await this.repo.findAll();
    return sources.map((e) => this.entityToDto(e));
  }

  async getById(id: string): Promise<InfoSourceDto> {
    const entity = await this.repo.findById(id);
    if (!entity) throw new NotFoundException(`InfoSource not found: ${id}`);
    return this.entityToDto(entity);
  }

  async create(dto: CreateInfoSourceDto): Promise<InfoSourceDto> {
    this.validateType(dto.type, dto.config);
    const id = this.buildId();
    this.logger.log(
      `creating info-source id=${id} type=${dto.type} name=${dto.name}`,
    );
    const entity = await this.repo.create({
      _id: id,
      type: dto.type,
      name: dto.name,
      config: dto.config,
      enabled: dto.enabled ?? true,
    });
    return this.entityToDto(entity);
  }

  async update(id: string, dto: UpdateInfoSourceDto): Promise<InfoSourceDto> {
    // 若本次 patch 含 type 或 config，重新校验两者组合（拿现有值补缺字段）
    if (dto.type !== undefined || dto.config !== undefined) {
      const existing = await this.repo.findById(id);
      if (!existing) throw new NotFoundException(`InfoSource not found: ${id}`);
      const effectiveType = dto.type ?? existing.type;
      const effectiveConfig = dto.config ?? existing.config;
      this.validateType(effectiveType, effectiveConfig);
    }

    this.logger.log(
      `updating info-source id=${id} name=${dto.name ?? '(unchanged)'}`,
    );
    const updated = await this.repo.update(id, {
      type: dto.type,
      name: dto.name,
      config: dto.config,
      enabled: dto.enabled,
    });
    if (!updated) throw new NotFoundException(`InfoSource not found: ${id}`);
    return this.entityToDto(updated);
  }

  async delete(id: string): Promise<void> {
    // task #35: 检查是否有事项订阅了该信息源，有则拒绝删除（不级联自动解订阅）
    const allConfigs = await this.smartTopicConfigRepository.findAll();
    const subscriberCount = allConfigs.filter((c) =>
      c.sourceIds.includes(id),
    ).length;
    if (subscriberCount > 0) {
      throw new BadRequestException(
        `该信息源被 ${subscriberCount} 个事项订阅，删除前请先取消订阅`,
      );
    }

    this.logger.log(`deleting info-source id=${id}`);
    await this.repo.deleteById(id);
  }
}
