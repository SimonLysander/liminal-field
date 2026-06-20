/**
 * InfoSourceService — 信息源 CRUD 业务层。
 *
 * 首期只支持 type=rss，其他 type 在 service 层 BadRequest 拦截。
 * config.url 校验：必填且必须 https?:// 开头（防误填 feed:// 或裸域名）。
 *
 * 删除依赖检查暂不实现 —— task #35 SmartTopicConfig 完成后在此加查询。
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { InfoSourceRepository } from './info-source.repository';
import { InfoSourceType, type InfoSource } from './info-source.entity';
import type {
  CreateInfoSourceDto,
  UpdateInfoSourceDto,
  InfoSourceDto,
} from './dto/info-source.dto';

const RSS_URL_RE = /^https?:\/\//;

@Injectable()
export class InfoSourceService {
  private readonly logger = new Logger(InfoSourceService.name);

  constructor(private readonly repo: InfoSourceRepository) {}

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
    // TODO task #35: 检查 SmartTopicConfig 是否有引用此 source，有则拒绝删除
    this.logger.log(`deleting info-source id=${id}`);
    await this.repo.deleteById(id);
  }
}
