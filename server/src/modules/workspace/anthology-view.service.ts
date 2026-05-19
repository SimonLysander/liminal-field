/**
 * AnthologyViewService — 文集 scope 的特有视图逻辑。
 *
 * 架构角色：与 GalleryViewService 对称，处理 anthology scope 独有的：
 * - 索引文件（main.md）的 frontmatter 解析/序列化
 * - 条目文件（entries/eXXX.md）的 frontmatter + 正文解析/序列化
 * - 条目的增删改查（每次操作产生新 snapshot）
 * - 展示端 / 管理端 DTO 组装
 *
 * 文件协议（详见 docs/unified-content-architecture.md）：
 * - 索引：main.md，frontmatter 含 title/description/entries 列表
 * - 条目：entries/eXXX.md，frontmatter 含 title/date，正文是 Markdown
 *
 * 版本存储：
 * - 索引快照：fileName=null（ContentItem.latestVersion 跟踪的即此）
 * - 条目快照：fileName="entries/e001.md" 等（不影响 latestVersion）
 *
 * 不包含 CRUD 的创建/删除逻辑（由 WorkspaceService 处理），
 * 也不处理 Navigation 索引（由 WorkspaceService 负责注册）。
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { nanoid } from 'nanoid';
import * as yaml from 'js-yaml';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { ContentService } from '../content/content.service';
import { ContentStatus } from '../content/content-item.entity';
import { ContentSaveAction } from '../content/dto/save-content.dto';
import {
  AnthologyPublicListItemDto,
  AnthologyPublicDetailDto,
  AnthologyAdminListItemDto,
  AnthologyAdminDetailDto,
  AnthologyEntryDetailDto,
  AnthologyAdminEntryRef,
} from './dto/anthology-view.dto';
import { ContentHistoryEntryDto } from '../content/dto/content-history.dto';
import { SaveAnthologyEntryDto } from './dto/save-anthology.dto';
import { EditorDraftRepository } from './editor-draft.repository';
import { EditorDraft } from './editor-draft.entity';
import { EditorDraftDto } from './dto/editor-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

// ─── 内部数据结构 ───────────────────────────────────────────────────────────

/**
 * 索引 frontmatter 中的单个条目引用（存储结构）。
 *
 * publishedVersionId：条目级发布的核心字段。
 * - 非 null → 该条目已发布，值为对应 ContentSnapshot 的 versionId
 * - null    → 该条目未发布（读者看不到）
 */
interface FrontmatterEntryRef {
  key: string;
  title: string;
  date: string | null;
  /** 已发布的 snapshot versionId，null 表示条目未发布。 */
  publishedVersionId: string | null;
}

/** 解析 main.md 的返回结构。 */
interface ParsedAnthologyIndex {
  title: string;
  description: string;
  entries: FrontmatterEntryRef[];
}

/** 解析条目文件的返回结构。 */
interface ParsedEntryContent {
  title: string;
  date: string | null;
  /** frontmatter 后的正文 Markdown。 */
  bodyMarkdown: string;
}

// ─── 纯函数（解析/序列化）── export 供单元测试 ──────────────────────────────

/**
 * 解析文集索引 frontmatter（main.md bodyMarkdown）。
 *
 * 边界情况：
 * - 无 frontmatter → 返回空默认值
 * - frontmatter 中 entries 缺失 → 默认 []
 * - entries 中 date 字段可以是 Date 对象（js-yaml 自动转换），转换为 ISO 日期字符串
 * - publishedVersionId 缺失 → 默认 null（向后兼容旧索引文件）
 */
export function parseAnthologyIndex(raw: string): ParsedAnthologyIndex {
  const defaults: ParsedAnthologyIndex = { title: '', description: '', entries: [] };

  if (!raw.startsWith('---')) return defaults;

  const closingIdx = raw.indexOf('\n---', 3);
  if (closingIdx === -1) return defaults;

  const yamlContent = raw.slice(4, closingIdx);

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    return defaults;
  }

  const title = typeof parsed.title === 'string' ? parsed.title : '';
  const description = typeof parsed.description === 'string' ? parsed.description : '';

  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const entries: FrontmatterEntryRef[] = rawEntries
    .filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object')
    .map((e) => ({
      key: typeof e.key === 'string' ? e.key : '',
      title: typeof e.title === 'string' ? e.title : '',
      // js-yaml 会将符合 ISO 格式的日期自动解析为 Date 对象
      date: normalizeDate(e.date),
      // publishedVersionId 缺失时默认 null，兼容旧格式索引
      publishedVersionId: typeof e.publishedVersionId === 'string' ? e.publishedVersionId : null,
    }))
    .filter((e) => e.key !== '');

  return { title, description, entries };
}

/**
 * 将各种来源的日期值规范化为 ISO 日期字符串（"YYYY-MM-DD"）或 null。
 * js-yaml 解析时 YAML 裸日期（2026-05-01，无引号）会被自动转为 Date 对象。
 */
function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return null;
}

/**
 * 序列化文集索引为 main.md bodyMarkdown（纯 frontmatter，无正文）。
 * entries 中的 date 始终以字符串写出，避免 js-yaml 反向解析。
 * publishedVersionId 为 null 时显式写出（null 表示未发布，与字段缺失语义一致，但写出便于调试）。
 */
export function serializeAnthologyIndex(data: ParsedAnthologyIndex): string {
  const frontmatterObj: Record<string, unknown> = {
    title: data.title,
    description: data.description,
    entries: data.entries.map((e) => ({
      key: e.key,
      title: e.title,
      // 写入 YAML 时用带引号的字符串，防止 js-yaml 把日期转回 Date 对象
      ...(e.date !== null ? { date: e.date } : {}),
      // publishedVersionId: null 写出供运维调试，解析时缺失也默认 null
      publishedVersionId: e.publishedVersionId ?? null,
    })),
  };

  const yamlStr = yaml.dump(frontmatterObj, {
    indent: 2,
    lineWidth: -1,
    /* 强制引号，防止 js-yaml 把日期字符串 "2026-05-19" 序列化为 Date 格式 */
    forceQuotes: true,
    quotingType: '"',
  });
  return `---\n${yamlStr}---\n`;
}

/**
 * 解析条目文件（entries/eXXX.md bodyMarkdown）。
 * frontmatter 含 title + date，正文是 Markdown。
 */
export function parseEntryContent(raw: string): ParsedEntryContent {
  const defaults: ParsedEntryContent = { title: '', date: null, bodyMarkdown: raw };

  if (!raw.startsWith('---')) return defaults;

  const closingIdx = raw.indexOf('\n---', 3);
  if (closingIdx === -1) return defaults;

  const yamlContent = raw.slice(4, closingIdx);
  const body = raw.slice(closingIdx + 4).trimStart();

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    return defaults;
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    date: normalizeDate(parsed.date),
    bodyMarkdown: body,
  };
}

/**
 * 序列化条目为带 frontmatter 的完整文件内容。
 * bodyMarkdown 参数是纯正文（不含 frontmatter），后端包装 frontmatter 后存储。
 */
export function serializeEntryContent(data: {
  title: string;
  date: string | null;
  bodyMarkdown: string;
}): string {
  const frontmatterObj: Record<string, unknown> = { title: data.title };
  /* 日期强制用引号字符串，防止 js-yaml 把 "2026-05-19" 解析为 Date 对象再序列化成怪格式 */
  if (data.date) frontmatterObj.date = data.date;

  const yamlStr = yaml.dump(frontmatterObj, { indent: 2, lineWidth: -1, forceQuotes: true, quotingType: '"' });
  return `---\n${yamlStr}---\n\n${data.bodyMarkdown}`;
}

/**
 * 生成唯一的条目 key（e_{nanoid8}）。
 * 用 nanoid 而非自增序号，避免删除条目后重建同名 key 导致旧 snapshot 污染新条目。
 */
export function generateEntryKey(): string {
  return `e_${nanoid(8)}`;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class AnthologyViewService {
  private readonly logger = new Logger(AnthologyViewService.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentService: ContentService,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly editorDraftRepository: EditorDraftRepository,
  ) {}

  // ── 内部辅助 ──────────────────────────────────────────────────────────────

  /**
   * 加载并解析最新的索引 snapshot（main.md）。
   * 刚创建尚无快照时返回空默认值（不抛异常）。
   */
  private async loadIndex(contentItemId: string): Promise<ParsedAnthologyIndex> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item) throw new NotFoundException(`Anthology ${contentItemId} not found`);

    const versionId = item.latestVersion?.versionId;
    if (!versionId) return { title: '', description: '', entries: [] };

    const snapshot = await this.snapshotRepository.findByVersionId(versionId);
    if (!snapshot) return { title: '', description: '', entries: [] };

    return parseAnthologyIndex(snapshot.bodyMarkdown);
  }

  /**
   * 将新的索引数据序列化并提交为新 snapshot（fileName=null → 更新 latestVersion）。
   *
   * title 回退策略：
   * - indexData.title 非空时直接使用（正常路径）
   * - indexData.title 为空时（文集刚创建、首次添加条目尚无索引 snapshot），
   *   回退到 ContentItem.latestVersion.title（createContent 时已写入 dto.title）。
   * - ContentSnapshot.title 是 required 字段，不能传空字符串。
   */
  private async commitIndex(
    contentItemId: string,
    indexData: ParsedAnthologyIndex,
    changeNote: string,
  ): Promise<void> {
    // 当 indexData.title 为空时（首次 addEntry，文集尚无索引 snapshot），
    // 从 ContentItem.latestVersion 取创建时存入的 title，避免 Mongoose required 校验失败。
    let resolvedTitle = indexData.title;
    if (!resolvedTitle) {
      const item = await this.contentRepository.findById(contentItemId);
      resolvedTitle = item?.latestVersion?.title ?? '';
    }

    const bodyMarkdown = serializeAnthologyIndex(indexData);
    await this.contentService.saveContent(contentItemId, {
      title: resolvedTitle,
      summary: indexData.description,
      bodyMarkdown,
      changeNote,
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
      // fileName 不传（= null），表示这是 main.md，会更新 latestVersion
    });
  }

  /**
   * 保存条目 snapshot（fileName="entries/eXXX.md"）。
   * 不会影响 ContentItem.latestVersion（只跟踪 main.md）。
   */
  private async commitEntry(
    contentItemId: string,
    entryKey: string,
    dto: SaveAnthologyEntryDto,
  ): Promise<void> {
    const fullContent = serializeEntryContent({
      title: dto.title,
      date: dto.date ?? null,
      bodyMarkdown: dto.bodyMarkdown,
    });

    await this.contentService.saveContent(contentItemId, {
      title: dto.title,
      summary: dto.title,
      bodyMarkdown: fullContent,
      changeNote: dto.changeNote ?? `编辑条目 ${entryKey}`,
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
      fileName: `entries/${entryKey}.md`,
    });
  }

  /**
   * 若文集已发布（publishedVersion 非 null），同步更新 publishedVersion 指向最新索引 snapshot。
   * 条目级发布/取消发布后调用，确保读者看到最新的条目列表。
   */
  private async syncPublishedVersionIfNeeded(contentItemId: string): Promise<void> {
    const item = await this.contentRepository.findById(contentItemId);
    if (item?.publishedVersion) {
      await this.contentService.publishVersion(contentItemId);
    }
  }

  /**
   * 根据条目在列表中的位置计算 prev/next 导航引用。
   */
  private buildPrevNext(
    entries: { key: string; title: string }[],
    entryIdx: number,
  ): { prev: { key: string; title: string } | null; next: { key: string; title: string } | null } {
    const prev = entryIdx > 0
      ? { key: entries[entryIdx - 1].key, title: entries[entryIdx - 1].title }
      : null;
    const next = entryIdx < entries.length - 1
      ? { key: entries[entryIdx + 1].key, title: entries[entryIdx + 1].title }
      : null;
    return { prev, next };
  }

  // ── 条目 CRUD ────────────────────────────────────────────────────────────

  /**
   * 添加条目：
   * 1. 生成新条目 key（nanoid）
   * 2. 创建初始空 snapshot
   * 3. 更新索引 snapshot（添加新条目到 entries 列表）
   */
  async addEntry(
    contentItemId: string,
    dto: SaveAnthologyEntryDto,
  ): Promise<AnthologyAdminDetailDto> {
    const indexData = await this.loadIndex(contentItemId);
    const newKey = generateEntryKey();

    // 创建初始空 snapshot（与 Notes createContent 一致：source='system', changeNote='自动创建'）
    // 用户内容由编辑器提交，这里只做系统初始化
    await this.contentService.saveContent(contentItemId, {
      title: dto.title,
      summary: '',
      bodyMarkdown: '',
      changeNote: '自动创建',
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
      fileName: `entries/${newKey}.md`,
      source: 'system',
    });

    // 更新索引（添加新条目到末尾，新条目默认未发布）
    const newEntry: FrontmatterEntryRef = {
      key: newKey,
      title: dto.title,
      date: dto.date ?? null,
      publishedVersionId: null,
    };
    const updatedIndex: ParsedAnthologyIndex = {
      ...indexData,
      entries: [...indexData.entries, newEntry],
    };
    await this.commitIndex(contentItemId, updatedIndex, `添加条目 ${newKey}: ${dto.title}`);

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 编辑条目：
   * 1. 提交条目内容新版本 snapshot
   * 2. 如果 title 或 date 变了，更新索引中对应的冗余字段
   * 3. 提交成功后自动删除该条目的草稿（与 notes commit 后删草稿对称）
   */
  async saveEntry(
    contentItemId: string,
    entryKey: string,
    dto: SaveAnthologyEntryDto,
  ): Promise<AnthologyAdminDetailDto> {
    const indexData = await this.loadIndex(contentItemId);
    const entryRef = indexData.entries.find((e) => e.key === entryKey);
    if (!entryRef) {
      throw new NotFoundException(`Entry ${entryKey} not found in anthology ${contentItemId}`);
    }

    // 提交条目内容新版本
    await this.commitEntry(contentItemId, entryKey, dto);

    // title 或 date 有变化时同步更新索引冗余字段（不修改 publishedVersionId）
    const titleChanged = entryRef.title !== dto.title;
    const dateChanged = entryRef.date !== (dto.date ?? null);

    if (titleChanged || dateChanged) {
      const updatedEntries = indexData.entries.map((e) =>
        e.key === entryKey
          // 保留 publishedVersionId 不变，只更新 title/date 冗余字段
          ? { ...e, title: dto.title, date: dto.date ?? null }
          : e,
      );
      await this.commitIndex(
        contentItemId,
        { ...indexData, entries: updatedEntries },
        `更新条目 ${entryKey} 元数据`,
      );
    }

    // 提交成功后自动清理该条目的草稿（忽略错误，不影响主流程）
    const fileName = `entries/${entryKey}.md`;
    await this.editorDraftRepository
      .deleteByContentItemAndFileName(contentItemId, fileName)
      .catch((err) => this.logger.warn(`清理条目草稿失败（非致命）: ${String(err)}`));

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 删除条目：从索引移除 + 清理该条目的所有 snapshot 和草稿。
   */
  async removeEntry(
    contentItemId: string,
    entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    const indexData = await this.loadIndex(contentItemId);
    const entryRef = indexData.entries.find((e) => e.key === entryKey);
    if (!entryRef) {
      throw new NotFoundException(`Entry ${entryKey} not found in anthology ${contentItemId}`);
    }

    // 已发布的条目不能直接删除，必须先取消发布
    if (entryRef.publishedVersionId !== null) {
      throw new BadRequestException('已发布的条目不能删除，请先取消发布');
    }

    // 从索引移除
    const updatedIndex: ParsedAnthologyIndex = {
      ...indexData,
      entries: indexData.entries.filter((e) => e.key !== entryKey),
    };
    await this.commitIndex(contentItemId, updatedIndex, `删除条目 ${entryKey}`);

    // 删除条目后同步已发布版本（否则展示端仍显示已删除的条目）
    await this.syncPublishedVersionIfNeeded(contentItemId);

    // 并行清理该条目的所有 snapshot 和草稿（非致命，失败不影响主流程）
    const fileName = `entries/${entryKey}.md`;
    await Promise.all([
      this.snapshotRepository.deleteByFileName(contentItemId, fileName)
        .catch((err) => this.logger.warn(`清理条目 snapshot 失败（非致命）: ${String(err)}`)),
      this.editorDraftRepository.deleteByContentItemAndFileName(contentItemId, fileName)
        .catch((err) => this.logger.warn(`清理条目草稿失败（非致命）: ${String(err)}`)),
    ]);

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 重排条目顺序：newOrder 必须包含且仅包含当前所有条目的 key。
   */
  async reorderEntries(
    contentItemId: string,
    newOrder: string[],
  ): Promise<AnthologyAdminDetailDto> {
    const indexData = await this.loadIndex(contentItemId);
    const currentKeys = new Set(indexData.entries.map((e) => e.key));

    // 校验：新顺序的 key 集合必须与当前完全一致
    const isValidOrder =
      newOrder.length === currentKeys.size &&
      newOrder.every((k) => currentKeys.has(k));

    if (!isValidOrder) {
      throw new BadRequestException(
        'newOrder 必须包含且仅包含当前所有条目的 key',
      );
    }

    // 按新顺序重排（保持 title/date 等元数据不变）
    const entryMap = new Map(indexData.entries.map((e) => [e.key, e]));
    const reorderedEntries = newOrder.map((k) => entryMap.get(k)!);

    await this.commitIndex(
      contentItemId,
      { ...indexData, entries: reorderedEntries },
      '重排条目顺序',
    );

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 获取单篇条目详情（展示端 + 管理端通用）。
   * 含正文和 prev/next 导航（按索引顺序）。
   *
   * @param usePublished true 时从已发布版本的索引中取 prev/next（展示端），
   *                     false 时从最新索引取（管理端/编辑场景）。
   */
  async getEntryDetail(
    contentItemId: string,
    entryKey: string,
    usePublished = false,
  ): Promise<AnthologyEntryDetailDto> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item) throw new NotFoundException(`Anthology ${contentItemId} not found`);

    // 取索引：展示端用已发布版本，管理端用最新版本
    let indexData: ParsedAnthologyIndex;
    if (usePublished) {
      if (!item.publishedVersion) {
        throw new NotFoundException(`Anthology ${contentItemId} is not published`);
      }
      const publishedSnapshot = await this.snapshotRepository.findByVersionId(
        item.publishedVersion.versionId!,
      );
      indexData = publishedSnapshot
        ? parseAnthologyIndex(publishedSnapshot.bodyMarkdown)
        : { title: '', description: '', entries: [] };
    } else {
      indexData = await this.loadIndex(contentItemId);
    }

    // 展示端只能看到 publishedVersionId 非 null 的条目
    const visibleEntries = usePublished
      ? indexData.entries.filter((e) => e.publishedVersionId !== null)
      : indexData.entries;

    const entryIdx = visibleEntries.findIndex((e) => e.key === entryKey);
    if (entryIdx === -1) {
      throw new NotFoundException(`Entry ${entryKey} not found in anthology ${contentItemId}`);
    }

    const entryRef = visibleEntries[entryIdx];
    const fileName = `entries/${entryKey}.md`;

    let entrySnapshot;
    if (usePublished && entryRef.publishedVersionId) {
      // 展示端：从 publishedVersionId 指向的冻结 snapshot 读取内容（严格版本隔离）
      entrySnapshot = await this.snapshotRepository.findByVersionId(entryRef.publishedVersionId);
    } else {
      // 管理端：从最新 snapshot 读取内容
      entrySnapshot = await this.snapshotRepository.findLatestByFileName(
        contentItemId,
        fileName,
      );
    }

    if (!entrySnapshot) {
      throw new NotFoundException(`Entry ${entryKey} has no content snapshot`);
    }

    // updatedAt：始终取该条目最新 snapshot 的 createdAt（与 NoteReader 的 updatedAt 同语义）
    const latestSnapshot = await this.snapshotRepository.findLatestByFileName(
      contentItemId,
      fileName,
    );

    const parsed = parseEntryContent(entrySnapshot.bodyMarkdown);
    const { prev, next } = this.buildPrevNext(visibleEntries, entryIdx);

    return {
      key: entryKey,
      title: parsed.title || entrySnapshot.title,
      date: parsed.date ?? entrySnapshot.createdAt.toISOString().split('T')[0],
      updatedAt: (latestSnapshot ?? entrySnapshot).createdAt.toISOString(),
      bodyMarkdown: parsed.bodyMarkdown,
      prev,
      next,
    };
  }

  // ── 发布 ──────────────────────────────────────────────────────────────────

  /**
   * 文集级发布（上线）：调用 ContentService.publishVersion，
   * 将 ContentItem.publishedVersion 指向当前最新索引 snapshot。
   *
   * 校验规则：文集必须有至少一个已发布条目（publishedVersionId 非 null），
   * 否则上线后读者看到的是空文集，没有意义。
   */
  async publishAnthology(contentItemId: string): Promise<void> {
    const indexData = await this.loadIndex(contentItemId);
    const publishedEntries = indexData.entries.filter((e) => e.publishedVersionId !== null);
    if (publishedEntries.length === 0) {
      throw new BadRequestException('无法发布：文集中没有已发布的条目，请先发布至少一篇条目');
    }
    await this.contentService.publishVersion(contentItemId);
  }

  /**
   * 文集级取消发布（下线）：调用 ContentService.unpublishVersion，
   * 清除 publishedVersion 指针，读者立即看不到该文集。
   */
  async unpublishAnthology(contentItemId: string): Promise<void> {
    await this.contentService.unpublishVersion(contentItemId);
  }

  /**
   * 发布单篇条目：
   * 1. 查该条目最新 snapshot 的 versionId
   * 2. 更新索引 frontmatter 中该条目的 publishedVersionId = versionId
   * 3. 提交新的索引 snapshot（commitIndex）
   * 4. 如果文集已发布（publishedVersion 非 null），同步更新 publishedVersion 指向新索引
   * 5. 返回更新后的管理端详情
   */
  async publishEntry(
    contentItemId: string,
    entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    const indexData = await this.loadIndex(contentItemId);
    const entryRef = indexData.entries.find((e) => e.key === entryKey);
    if (!entryRef) {
      throw new NotFoundException(`Entry ${entryKey} not found in anthology ${contentItemId}`);
    }

    // 取该条目的最新 snapshot versionId
    const fileName = `entries/${entryKey}.md`;
    const latestSnapshot = await this.snapshotRepository.findLatestByFileName(
      contentItemId,
      fileName,
    );
    if (!latestSnapshot) {
      throw new BadRequestException(`条目 ${entryKey} 尚无内容，无法发布`);
    }

    // 更新索引：将该条目的 publishedVersionId 指向最新 snapshot
    const updatedEntries = indexData.entries.map((e) =>
      e.key === entryKey
        ? { ...e, publishedVersionId: latestSnapshot.versionId }
        : e,
    );
    await this.commitIndex(
      contentItemId,
      { ...indexData, entries: updatedEntries },
      `发布条目 ${entryKey}`,
    );

    await this.syncPublishedVersionIfNeeded(contentItemId);
    return this.toAdminDetail(contentItemId);
  }

  /**
   * 取消发布单篇条目：将索引中该条目的 publishedVersionId 设为 null。
   * 如果文集已发布，同步更新 publishedVersion 指向新索引。
   */
  async unpublishEntry(
    contentItemId: string,
    entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    const indexData = await this.loadIndex(contentItemId);
    const entryRef = indexData.entries.find((e) => e.key === entryKey);
    if (!entryRef) {
      throw new NotFoundException(`Entry ${entryKey} not found in anthology ${contentItemId}`);
    }

    const updatedEntries = indexData.entries.map((e) =>
      e.key === entryKey ? { ...e, publishedVersionId: null } : e,
    );
    await this.commitIndex(
      contentItemId,
      { ...indexData, entries: updatedEntries },
      `取消发布条目 ${entryKey}`,
    );

    await this.syncPublishedVersionIfNeeded(contentItemId);
    return this.toAdminDetail(contentItemId);
  }

  /**
   * 批量发布所有条目：一次性对所有条目执行 publishEntry 逻辑，
   * 只提交一个索引 snapshot（不是逐条提交，效率更高）。
   * 如果文集已发布，最后同步更新 publishedVersion。
   */
  async publishAllEntries(contentItemId: string): Promise<AnthologyAdminDetailDto> {
    const indexData = await this.loadIndex(contentItemId);

    // 并行查询所有条目的最新 snapshot versionId
    const updatedEntries = await Promise.all(
      indexData.entries.map(async (e) => {
        const fileName = `entries/${e.key}.md`;
        const latestSnapshot = await this.snapshotRepository.findLatestByFileName(
          contentItemId,
          fileName,
        );
        // 有内容的条目才更新 publishedVersionId（无内容的条目跳过）
        if (latestSnapshot) {
          return { ...e, publishedVersionId: latestSnapshot.versionId };
        }
        return e;
      }),
    );

    await this.commitIndex(
      contentItemId,
      { ...indexData, entries: updatedEntries },
      '批量发布所有条目',
    );

    await this.syncPublishedVersionIfNeeded(contentItemId);
    return this.toAdminDetail(contentItemId);
  }

  // ── 条目草稿 CRUD ────────────────────────────────────────────────────────

  /** 将 EditorDraft 实体转为 EditorDraftDto。 */
  private toDraftDto(draft: EditorDraft): EditorDraftDto {
    return {
      id: draft._id,
      contentItemId: draft.contentItemId,
      title: draft.title,
      summary: draft.summary,
      bodyMarkdown: draft.bodyMarkdown,
      changeNote: draft.changeNote,
      savedAt: draft.savedAt.toISOString(),
      savedBy: draft.savedBy,
    };
  }

  /**
   * 获取条目草稿。先验证文集存在，再按 fileName 查询草稿。
   * 无草稿返回 null（200），避免 404 噪音。
   */
  async getEntryDraft(
    contentItemId: string,
    entryKey: string,
  ): Promise<EditorDraftDto | null> {
    await this.contentService.assertContentItemExists(contentItemId);
    const fileName = `entries/${entryKey}.md`;
    const draft = await this.editorDraftRepository.findByContentItemAndFileName(
      contentItemId,
      fileName,
    );
    if (!draft) return null;
    return this.toDraftDto(draft);
  }

  /**
   * 保存条目草稿（autosave）。
   * 只写 MongoDB，不产生 Git snapshot。
   */
  async saveEntryDraft(
    contentItemId: string,
    entryKey: string,
    dto: SaveDraftDto,
  ): Promise<EditorDraftDto> {
    await this.contentService.assertContentEditable(contentItemId);
    const fileName = `entries/${entryKey}.md`;
    const draft = await this.editorDraftRepository.saveWithFileName({
      contentItemId,
      fileName,
      title: dto.title,
      summary: dto.summary ?? '',
      bodyMarkdown: dto.bodyMarkdown,
      changeNote: dto.changeNote,
      savedAt: new Date(),
      savedBy: dto.savedBy,
    });
    return this.toDraftDto(draft);
  }

  /**
   * 丢弃条目草稿。
   * 前端用户主动丢弃时调用；saveEntry 提交后也会自动调用（内部逻辑）。
   */
  async deleteEntryDraft(
    contentItemId: string,
    entryKey: string,
  ): Promise<void> {
    await this.contentService.assertContentItemExists(contentItemId);
    const fileName = `entries/${entryKey}.md`;
    await this.editorDraftRepository.deleteByContentItemAndFileName(
      contentItemId,
      fileName,
    );
  }

  // ── 条目版本历史 ─────────────────────────────────────────────────────────

  /**
   * 获取单篇条目的历史版本内容（按 versionId 精确查找 snapshot）。
   *
   * 用于管理端版本时间线点击后，在中栏展示历史版本正文。
   * 与 NoteViewService.getByVersion 语义对等：
   *   - 从 snapshot 解析 frontmatter（title/date）+ 正文
   *   - prev/next 从最新索引取（管理端视角，不区分是否已发布）
   *
   * @param contentItemId 文集 ContentItem ID
   * @param entryKey      条目 key（e001 等），用于定位索引 prev/next
   * @param versionId     目标 snapshot 的 versionId
   */
  async getEntryByVersion(
    contentItemId: string,
    entryKey: string,
    versionId: string,
  ): Promise<AnthologyEntryDetailDto> {
    await this.contentService.assertContentItemExists(contentItemId);

    const snapshot = await this.snapshotRepository.findByVersionId(versionId);
    if (!snapshot) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    const parsed = parseEntryContent(snapshot.bodyMarkdown);

    // prev/next 从最新索引取（管理端预览历史版本，导航仍以当前条目列表为准）
    const indexData = await this.loadIndex(contentItemId);
    const entryIdx = indexData.entries.findIndex((e) => e.key === entryKey);
    const { prev, next } = this.buildPrevNext(indexData.entries, entryIdx);

    return {
      key: entryKey,
      title: parsed.title || snapshot.title,
      date: parsed.date ?? snapshot.createdAt.toISOString().split('T')[0],
      updatedAt: snapshot.createdAt.toISOString(),
      bodyMarkdown: parsed.bodyMarkdown,
      prev,
      next,
    };
  }

  /**
   * 获取单篇条目的版本历史（fileName="entries/eXXX.md" 对应的 snapshot 列表）。
   * 用于管理端右侧面板的版本时间线组件，与 Notes 的 getHistory 语义对等。
   */
  async getEntryHistory(
    contentItemId: string,
    entryKey: string,
  ): Promise<ContentHistoryEntryDto[]> {
    await this.contentService.assertContentItemExists(contentItemId);
    const fileName = `entries/${entryKey}.md`;
    const snapshots = await this.contentService.listVersionsByFileName(contentItemId, fileName);
    return snapshots.map((snap) => ({
      versionId: snap.versionId,
      commitHash: snap.commitHash ?? '',
      committedAt: snap.createdAt.toISOString(),
      changeType: 'patch',
      changeNote: snap.changeNote ?? '',
      source: snap.source ?? 'user',
      title: snap.title,
    }));
  }

  // ── DTO 组装 ─────────────────────────────────────────────────────────────

  /**
   * 加载已发布版本的索引：校验文集存在且已发布，返回 ContentItem + 解析后的索引数据。
   * 展示端 DTO 共用此逻辑，避免重复的 findById + publishedVersion 校验 + snapshot 加载。
   */
  private async loadPublishedIndex(contentItemId: string): Promise<{
    item: Awaited<ReturnType<ContentRepository['findById']>> & {};
    indexData: ParsedAnthologyIndex;
  }> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item) throw new NotFoundException(`Anthology ${contentItemId} not found`);
    if (!item.publishedVersion) {
      throw new NotFoundException(`Anthology ${contentItemId} is not published`);
    }

    const publishedSnapshot = await this.snapshotRepository.findByVersionId(
      item.publishedVersion.versionId!,
    );
    const indexData = publishedSnapshot
      ? parseAnthologyIndex(publishedSnapshot.bodyMarkdown)
      : { title: '', description: '', entries: [] };

    return { item, indexData };
  }

  /**
   * 展示端列表 DTO：从已发布版本的索引读取，entryCount 只计算已发布条目数。
   */
  async toPublicListItem(contentItemId: string): Promise<AnthologyPublicListItemDto> {
    const { item, indexData } = await this.loadPublishedIndex(contentItemId);
    const publishedEntries = indexData.entries.filter((e) => e.publishedVersionId !== null);

    return {
      id: contentItemId,
      title: item.publishedVersion!.title || indexData.title,
      description: indexData.description,
      entryCount: publishedEntries.length,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  /**
   * 展示端详情 DTO：从已发布版本的索引读取，只包含已发布条目。
   * 条目元数据（title/date）从索引冗余字段直接取，不读 snapshot 正文。
   */
  async toPublicDetail(contentItemId: string): Promise<AnthologyPublicDetailDto> {
    const { item, indexData } = await this.loadPublishedIndex(contentItemId);
    const publishedEntries = indexData.entries.filter((e) => e.publishedVersionId !== null);

    return {
      id: contentItemId,
      title: item.publishedVersion!.title || indexData.title,
      description: indexData.description,
      entries: await Promise.all(
        publishedEntries.map(async (e) => {
          // date 兜底：索引里没有时从已发布 snapshot 的 createdAt 取
          let date = e.date;
          if (!date && e.publishedVersionId) {
            const snap = await this.snapshotRepository.findByVersionId(e.publishedVersionId);
            if (snap) date = snap.createdAt.toISOString().split('T')[0];
          }
          return { key: e.key, title: e.title, date };
        }),
      ),
    };
  }

  /**
   * 管理端列表 DTO：从最新版本读取，含状态信息。
   */
  async toAdminListItem(contentItemId: string): Promise<AnthologyAdminListItemDto> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item) throw new NotFoundException(`Anthology ${contentItemId} not found`);

    const indexData = await this.loadIndex(contentItemId);

    return {
      id: contentItemId,
      title: item.latestVersion?.title || indexData.title,
      description: indexData.description,
      entryCount: indexData.entries.length,
      status: item.publishedVersion ? 'published' : 'committed',
      hasUnpublishedChanges: item.publishedVersion
        ? item.latestVersion?.versionId !== item.publishedVersion.versionId
        : false,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  /**
   * 管理端详情 DTO：从最新版本读取，含条目 hasContent、publishedVersionId、hasUnpublishedChanges。
   *
   * 每个条目的 hasUnpublishedChanges 判断：
   * - publishedVersionId 为 null → false（未发布，无"未发布的改动"概念）
   * - publishedVersionId 非 null，且最新 snapshot versionId != publishedVersionId → true
   */
  async toAdminDetail(contentItemId: string): Promise<AnthologyAdminDetailDto> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item) throw new NotFoundException(`Anthology ${contentItemId} not found`);

    const indexData = await this.loadIndex(contentItemId);

    // 并行查询每个条目的 snapshot 状态（hasContent + hasUnpublishedChanges）
    const entriesWithContent: AnthologyAdminEntryRef[] = await Promise.all(
      indexData.entries.map(async (e): Promise<AnthologyAdminEntryRef> => {
        const fileName = `entries/${e.key}.md`;
        const snapshot = await this.snapshotRepository.findLatestByFileName(
          contentItemId,
          fileName,
        );
        const hasContent = snapshot !== null && snapshot.bodyMarkdown.length > 0;

        // 有 publishedVersionId 且最新 snapshot 不同 → 有未发布的新改动
        const hasUnpublishedChanges =
          e.publishedVersionId !== null &&
          snapshot !== null &&
          snapshot.versionId !== e.publishedVersionId;

        return {
          key: e.key,
          title: e.title,
          // date 兜底：索引里没有时从 snapshot 的 createdAt 取
          date: e.date ?? (snapshot ? snapshot.createdAt.toISOString().split('T')[0] : null),
          hasContent,
          publishedVersionId: e.publishedVersionId,
          hasUnpublishedChanges,
        };
      }),
    );

    return {
      id: contentItemId,
      title: item.latestVersion?.title || indexData.title,
      description: indexData.description,
      status: item.publishedVersion ? 'published' : 'committed',
      hasUnpublishedChanges: item.publishedVersion
        ? item.latestVersion?.versionId !== item.publishedVersion.versionId
        : false,
      entries: entriesWithContent,
    };
  }
}
