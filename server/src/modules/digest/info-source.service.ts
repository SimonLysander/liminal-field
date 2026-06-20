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
 *   1a. migrate 老数据：无 category 字段的文档批量补 'engineering'。
 *   1b. migrate 旧 enum 值：tech/china_tech→engineering, reading→longform, academic→ai（5 类 refactor）。
 *   2. seed 内置源：首次启动时将 SEED_SOURCES 写入，已存在则跳过（幂等）。
 *
 * Task #42：category + description 全链路打通（entity / DTO / CRUD / list filter）。
 *   - create 时 category 必填（DTO 层 @IsEnum 已保证，service 不兜底）。
 *   - list 支持可选 category 过滤，透传给 repo.findAll。
 *   - entityToDto 补 category + description（老数据 description 返 null）。
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
   * 1a. 老数据没有 category 字段 → 批量补 'engineering'（updateMany，幂等）。
   * 1b. 数据库残留旧 enum 值（tech/china_tech/reading/academic）→ map 到新 5 类 enum。
   *     这步保证即使之前版本写入了旧值，重启后也能迁移干净。
   * 2. SEED_SOURCES 逐条按 name 查重，不存在则插入（不删用户已有的源）。
   */
  async onModuleInit(): Promise<void> {
    // ── Step 1a: 缺字段的老数据补默认 ─────────────────────────────────────
    const migrateResult = await this.infoSourceModel
      .updateMany(
        { category: { $exists: false } },
        { $set: { category: InfoSourceCategory.engineering } },
      )
      .exec();
    if (migrateResult.modifiedCount > 0) {
      this.logger.log(
        `migrate: 补 category='engineering' ${migrateResult.modifiedCount} 条老数据`,
      );
    }

    // ── Step 1b: 旧 enum 值 → 新 enum 值（7→5 类精简 refactor 后的 DB 迁移）──
    // tech/china_tech → engineering；reading → longform；academic → ai
    const oldToNew: Record<string, InfoSourceCategory> = {
      tech: InfoSourceCategory.engineering,
      china_tech: InfoSourceCategory.engineering,
      reading: InfoSourceCategory.longform,
      academic: InfoSourceCategory.ai,
    };
    for (const [oldVal, newVal] of Object.entries(oldToNew)) {
      // oldVal 是旧 enum 字符串值，DB 里已存在但 TypeScript enum 不再认识它；
      // 用 as unknown as InfoSourceCategory 绕过类型检查，仅用于 filter 条件（不污染业务逻辑）
      const res = await this.infoSourceModel
        .updateMany(
          { category: oldVal as unknown as InfoSourceCategory },
          { $set: { category: newVal } },
        )
        .exec();
      if (res.modifiedCount > 0) {
        this.logger.log(
          `migrate: category '${oldVal}' → '${newVal}' ${res.modifiedCount} 条`,
        );
      }
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

      // description 一并写入（Task #42），帮助 agent 在 system prompt 里识别该源用途
      await this.infoSourceModel.create({
        _id: `src_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        type: InfoSourceType.rss,
        name: seed.name,
        config: { url: resolvedUrl },
        category: seed.category,
        description: seed.description,
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
      // Task #42：category 保证存在（onModuleInit migrate 已兜底老数据）
      category: e.category,
      // Task #42：老数据无 description，返 null 而非 undefined，保持 wire format 稳定
      description: e.description ?? null,
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

  /**
   * 列出信息源，支持按 category 过滤（Task #42）。
   * opts.category 未传时返回全部；传无效值应在 controller 层 QueryDto 校验拦截。
   */
  async list(opts?: {
    category?: InfoSourceCategory;
  }): Promise<InfoSourceDto[]> {
    const sources = await this.repo.findAll(
      opts?.category ? { category: opts.category } : undefined,
    );
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
    // category 由 DTO 层 @IsEnum 强制校验，service 不再兜底 default（Task #42）
    const entity = await this.repo.create({
      _id: id,
      type: dto.type,
      name: dto.name,
      config: dto.config,
      enabled: dto.enabled ?? true,
      category: dto.category,
      description: dto.description,
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
    // Task #42：category / description 若有传则写入，undefined 时 repo.update 忽略
    const updated = await this.repo.update(id, {
      type: dto.type,
      name: dto.name,
      config: dto.config,
      enabled: dto.enabled,
      category: dto.category,
      description: dto.description,
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
