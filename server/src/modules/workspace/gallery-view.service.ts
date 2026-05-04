/**
 * GalleryViewService — 画廊 scope 的特有逻辑。
 *
 * 架构变更（frontmatter 协议迁移）：
 * 元数据存储从 MongoDB gallery_post_meta 集合迁移至 main.md 的 YAML frontmatter。
 * frontmatter 格式：
 *   cover: photo-xxx.jpg          # 封面图文件名（可选）
 *   tags:                          # 帖子级标签（可选）
 *     location: 北京
 *   photos:                        # 照片顺序/描述列表（可选）
 *     - file: photo-xxx.jpg
 *       caption: 老胡同里的光影
 *       tags:
 *         camera: GR III
 *
 * 处理画廊模块独有的视图转换：
 * - 解析 / 序列化 main.md frontmatter（使用项目已有的 js-yaml）
 * - 从 frontmatter 推导封面图（优先 cover 字段，否则退化为 assets 首图）
 * - 将 frontmatter photos 与 Git assets 目录合并（Git 为权威文件列表，frontmatter 提供顺序和描述）
 * - 照片计数、URL 构建、previewPhotoUrls（前 9 张）
 * - 照片文件直出（readPhotoBuffer）
 *
 * 不包含 CRUD 逻辑 — 那由 WorkspaceService 统一处理。
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { join, parse, extname } from 'path';
import * as yaml from 'js-yaml';
import { ContentRepository } from '../content/content.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentService } from '../content/content.service';
import { ContentStatus } from '../content/content-item.entity';
import { ContentSaveAction } from '../content/dto/save-content.dto';
import {
  GalleryPhotoDto,
  GalleryPublicListItemDto,
  GalleryPublicDetailDto,
  GalleryAdminListItemDto,
  GalleryAdminDetailDto,
  GalleryEditorPhotoDto,
  GalleryEditorDto,
  GalleryVersionDto,
  GalleryDraftDto,
} from './dto/gallery-view.dto';
import { EditorDraftRepository } from './editor-draft.repository';
import { SaveGalleryPostDto } from './dto/save-gallery-post.dto';
import { MinioService } from '../minio/minio.service';

/** main.md frontmatter 中单张照片的结构。 */
interface FrontmatterPhoto {
  file: string;
  caption: string;
  tags: Record<string, string>;
}

/** parseGalleryContent 的返回结构。 */
interface ParsedGalleryContent {
  photos: FrontmatterPhoto[];
  cover: string | null;
  tags: Record<string, string>;
  prose: string;
  /** 原始内容是否包含 frontmatter。无 frontmatter 的旧数据需要从 assets 推断照片列表。 */
  hasFrontmatter: boolean;
}

/**
 * 解析 main.md 原始字符串，提取 YAML frontmatter 和随笔正文。
 *
 * 边界情况：
 * - 无 frontmatter（旧数据兼容）→ photos=[], tags={}, cover=null，整体内容当 prose
 * - frontmatter 中 photos 字段缺失或为空 → 默认 []
 * - frontmatter 中 cover 字段缺失 → null
 *
 * export 供单元测试直接调用，不影响运行时封装。
 */
export function parseGalleryContent(raw: string): ParsedGalleryContent {
  // frontmatter 必须以 "---\n" 开头，否则视为无 frontmatter
  if (!raw.startsWith('---')) {
    return { photos: [], cover: null, tags: {}, prose: raw, hasFrontmatter: false };
  }

  // 找到第二个 "---" 分隔符的位置（跳过开头的 "---"）
  const closingMarkerIndex = raw.indexOf('\n---', 3);
  if (closingMarkerIndex === -1) {
    // 只有开头的 "---"，没有关闭标记，视为无 frontmatter
    return { photos: [], cover: null, tags: {}, prose: raw, hasFrontmatter: false };
  }

  const yamlContent = raw.slice(4, closingMarkerIndex); // "---\n" 之后到关闭 "---" 之前
  const prose = raw.slice(closingMarkerIndex + 4).trimStart(); // 关闭 "---\n" 之后的内容

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    // YAML 解析失败，降级为无 frontmatter
    return { photos: [], cover: null, tags: {}, prose: raw, hasFrontmatter: false };
  }

  // 提取 cover（字符串或 null）
  const cover = typeof parsed.cover === 'string' ? parsed.cover : null;

  // 提取帖子级 tags（key-value 映射，值强制转 string）
  const tags = parseTags(parsed.tags);

  // 提取 photos 数组，逐项规范化
  const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos : [];
  const photos: FrontmatterPhoto[] = rawPhotos
    .filter((p): p is Record<string, unknown> => p !== null && typeof p === 'object')
    .map((p) => ({
      file: typeof p.file === 'string' ? p.file : '',
      caption: typeof p.caption === 'string' ? p.caption : '',
      tags: parseTags(p.tags),
    }))
    .filter((p) => p.file !== ''); // 过滤掉 file 字段缺失的条目

  return { photos, cover, tags, prose, hasFrontmatter: true };
}

/**
 * 将任意值规范化为 Record<string, string>。
 * 只保留值为 string（或可 toString 的 primitive）的 key。
 */
function parseTags(raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v !== null && v !== undefined) {
      result[k] = String(v);
    }
  }
  return result;
}

/**
 * 将解析后的内容序列化为 main.md 字符串（frontmatter + prose）。
 * 始终生成 frontmatter（即使 photos 为空），确保 parseGalleryContent 能识别 hasFrontmatter=true。
 * 这对于"用户显式清空照片"的场景至关重要——没有 frontmatter 会触发旧数据兼容逻辑，
 * 从 assets 目录推断照片列表，导致已删除的照片重新出现。
 */
export function serializeGalleryContent(data: {
  photos: FrontmatterPhoto[];
  cover: string | null;
  tags: Record<string, string>;
  prose: string;
}): string {
  const frontmatterObj: Record<string, unknown> = {};
  if (data.cover !== null) frontmatterObj.cover = data.cover;
  if (Object.keys(data.tags).length > 0) frontmatterObj.tags = data.tags;
  // 始终写入 photos 字段（空数组也写），确保 frontmatter 存在
  frontmatterObj.photos = data.photos.map((p) => ({
    file: p.file,
    caption: p.caption,
    ...(Object.keys(p.tags).length > 0 ? { tags: p.tags } : { tags: {} }),
  }));

  const yamlStr = yaml.dump(frontmatterObj, { indent: 2, lineWidth: -1 });
  return `---\n${yamlStr}---\n\n${data.prose}`;
}

@Injectable()
export class GalleryViewService {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentService: ContentService,
    private readonly editorDraftRepository: EditorDraftRepository,
    private readonly minioService: MinioService,
  ) {}

  /** 构建照片的统一访问 URL（走 /spaces/gallery/items/:id/assets/:fileName）。 */
  private buildPhotoUrl(contentItemId: string, fileName: string): string {
    return `/api/v1/spaces/gallery/items/${contentItemId}/assets/${fileName}`;
  }

  /**
   * 发布前校验：目标版本的 frontmatter 中必须有照片才能发布。
   * @param commitHash 要发布的版本，不传则检查最新版本（工作目录）。
   */
  async assertPublishable(contentItemId: string, commitHash?: string): Promise<void> {
    let parsed: ParsedGalleryContent;
    if (commitHash) {
      // 读取指定版本的 main.md
      const source = await this.contentRepoService.readContentSource(contentItemId, { commitHash, scope: 'gallery' });
      parsed = parseGalleryContent(source.bodyMarkdown);
    } else {
      ({ parsed } = await this.loadParsedContent(contentItemId));
    }

    if (parsed.hasFrontmatter && parsed.photos.length === 0) {
      throw new BadRequestException('无法发布：相册中没有照片');
    }
    if (!parsed.hasFrontmatter) {
      const assets = await this.contentRepoService.listAssets(contentItemId);
      if (!assets.some((a) => a.type === 'image')) {
        throw new BadRequestException('无法发布：相册中没有照片');
      }
    }
  }

  /** 构建草稿照片的 MinIO 代理 URL。 */
  private buildDraftPhotoUrl(contentItemId: string, fileName: string): string {
    return `/api/v1/spaces/gallery/items/${contentItemId}/draft-assets/${fileName}`;
  }

  /**
   * 从 main.md 加载并解析 frontmatter，同时返回 Git assets 中的图片列表。
   * 两个调用方（公开/管理详情）复用此私有方法，避免重复读文件。
   */
  private async loadParsedContent(contentItemId: string): Promise<{
    parsed: ParsedGalleryContent;
    imageAssets: Awaited<ReturnType<ContentRepoService['listAssets']>>;
  }> {
    const [source, assets] = await Promise.all([
      this.contentRepoService.readContentSource(contentItemId, { scope: 'gallery' }).catch(() => null),
      this.contentRepoService.listAssets(contentItemId),
    ]);
    const parsed = source ? parseGalleryContent(source.bodyMarkdown) : { photos: [], cover: null, tags: {}, prose: '', hasFrontmatter: false };
    const imageAssets = assets.filter((a) => a.type === 'image');
    return { parsed, imageAssets };
  }

  /**
   * 将 frontmatter photos 与 Git assets 合并为 GalleryPhotoDto[]。
   *
   * 有 frontmatter 时：frontmatter 是照片列表的唯一权威来源，不追加 assets 里的未登记照片。
   * 无 frontmatter 时（旧数据兼容）：从 assets 目录推断照片列表。
   */
  private buildPhotoList(
    contentItemId: string,
    parsedPhotos: FrontmatterPhoto[],
    imageAssets: { fileName: string; size: number }[],
    hasFrontmatter: boolean,
  ): GalleryPhotoDto[] {
    // frontmatter 中登记的照片（按 frontmatter 顺序）
    const registeredPhotos: GalleryPhotoDto[] = parsedPhotos
      .map((p) => {
        const asset = imageAssets.find((a) => a.fileName === p.file);
        // frontmatter 登记但 assets 目录不存在（已被删除），跳过
        if (!asset) return null;
        return {
          id: p.file,
          url: this.buildPhotoUrl(contentItemId, p.file),
          fileName: p.file,
          caption: p.caption,
          tags: p.tags,
        } satisfies GalleryPhotoDto;
      })
      .filter((p): p is GalleryPhotoDto => p !== null);

    // 有 frontmatter → frontmatter 是权威来源，不追加未登记照片
    if (hasFrontmatter) {
      return registeredPhotos;
    }

    // 无 frontmatter（旧数据）→ 从 assets 目录推断完整列表
    return imageAssets.map((asset) => ({
      id: asset.fileName,
      url: this.buildPhotoUrl(contentItemId, asset.fileName),
      fileName: asset.fileName,
      caption: '',
      tags: {},
    }));
  }

  /**
   * 展示端列表 DTO：只含前端展示所需的最小字段。
   */
  async toPublicListItemDto(contentItemId: string): Promise<GalleryPublicListItemDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const { parsed } = await this.loadParsedContent(contentItemId);
    const version = content.latestVersion!;

    return {
      id: contentItemId,
      title: version.title,
      tags: parsed.tags,
      createdAt: content.createdAt.toISOString(),
    };
  }

  /**
   * 管理端列表 DTO：含封面图、照片计数、发布状态等管理所需字段。
   * 元数据来源：main.md YAML frontmatter（cover、tags、photos）。
   * 封面优先级：frontmatter.cover > assets 首图。
   */
  async toAdminListItemDto(contentItemId: string): Promise<GalleryAdminListItemDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const { parsed, imageAssets } = await this.loadParsedContent(contentItemId);

    // 封面图：frontmatter.cover 指定的文件必须存在于 assets，否则退化为首图
    const coverFileName = parsed.cover ?? null;
    const coverAsset = coverFileName
      ? (imageAssets.find((a) => a.fileName === coverFileName) ?? imageAssets[0])
      : imageAssets[0];

    const version = content.latestVersion!;

    return {
      id: contentItemId,
      title: version.title,
      status: content.publishedVersion ? 'published' : 'committed',
      coverUrl: coverAsset ? this.buildPhotoUrl(contentItemId, coverAsset.fileName) : null,
      photoCount: imageAssets.length,
      hasUnpublishedChanges: content.publishedVersion
        ? content.latestVersion?.commitHash !== content.publishedVersion?.commitHash
        : false,
      tags: parsed.tags,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  /**
   * 展示端详情 DTO：含完整照片列表，不含管理字段（封面文件名、publishedCommitHash 等）。
   */
  async toPublicDetailDto(contentItemId: string): Promise<GalleryPublicDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const { parsed, imageAssets } = await this.loadParsedContent(contentItemId);
    const photos = this.buildPhotoList(contentItemId, parsed.photos, imageAssets, parsed.hasFrontmatter);
    const version = content.latestVersion!;

    return {
      id: contentItemId,
      title: version.title,
      prose: parsed.prose,
      photos,
      tags: parsed.tags,
      createdAt: content.createdAt.toISOString(),
    };
  }

  /**
   * 管理端详情 DTO：含封面文件名、publishedCommitHash 等管理所需字段。
   */
  async toAdminDetailDto(contentItemId: string): Promise<GalleryAdminDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const { parsed, imageAssets } = await this.loadParsedContent(contentItemId);
    const photos = this.buildPhotoList(contentItemId, parsed.photos, imageAssets, parsed.hasFrontmatter);
    const version = content.latestVersion!;

    return {
      id: contentItemId,
      title: version.title,
      prose: parsed.prose,
      status: content.publishedVersion ? 'published' : 'committed',
      photos,
      coverPhotoFileName: parsed.cover,
      hasUnpublishedChanges: content.publishedVersion
        ? content.latestVersion?.commitHash !== content.publishedVersion?.commitHash
        : false,
      publishedCommitHash: content.publishedVersion?.commitHash ?? null,
      tags: parsed.tags,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  /**
   * 编辑器加载 DTO：后端合并草稿和正式版照片列表，前端不需要感知 MinIO vs Git 存储细节。
   *
   * 照片合并逻辑（迁移自前端 useGalleryEditor.ts）：
   * - 有草稿 → 用草稿的 title/prose/cover/tags + 草稿 photos 数组决定顺序和元数据
   * - 每张照片的 URL：
   *   - 存在于 Git assets → 用 Git URL（已提交的照片）
   *   - 否则（刚上传的草稿照片）→ 用 MinIO 代理 URL
   * - size：从 Git assets 获取，不存在则为 0
   * - 没草稿 → 直接用正式版数据
   */
  async getEditorState(contentItemId: string): Promise<GalleryEditorDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const [draft, assets] = await Promise.all([
      this.editorDraftRepository.findByContentItemId(contentItemId),
      this.contentRepoService.listAssets(contentItemId),
    ]);
    const imageAssets = assets.filter((a) => a.type === 'image');
    // Git assets 查找表：fileName → size
    const gitAssetMap = new Map(imageAssets.map((a) => [a.fileName, a.size]));

    if (draft) {
      // 有草稿：用草稿的元数据，并按草稿照片顺序合并 URL
      const parsed = parseGalleryContent(draft.bodyMarkdown);

      const photos: GalleryEditorPhotoDto[] = parsed.photos.map((p) => {
        const gitSize = gitAssetMap.get(p.file);
        // 已提交到 Git 的照片用 Git URL，刚上传的草稿照片用 MinIO 代理 URL
        const url = gitSize !== undefined
          ? this.buildPhotoUrl(contentItemId, p.file)
          : this.buildDraftPhotoUrl(contentItemId, p.file);
        return {
          file: p.file,
          url,
          size: gitSize ?? 0,
          caption: p.caption,
          tags: p.tags,
        };
      });

      return {
        id: contentItemId,
        title: draft.title,
        prose: parsed.prose,
        photos,
        cover: parsed.cover,
        tags: parsed.tags,
        hasDraft: true,
        draftSavedAt: draft.savedAt.toISOString(),
      };
    }

    // 无草稿：用正式版数据
    let parsed: ParsedGalleryContent = { photos: [], cover: null, tags: {}, prose: '' };
    try {
      const source = await this.contentRepoService.readContentSource(contentItemId, { scope: 'gallery' });
      parsed = parseGalleryContent(source.bodyMarkdown);
    } catch {
      // main.md 还不存在（刚创建的条目），使用默认空值
    }

    const photos: GalleryEditorPhotoDto[] = parsed.photos
      .filter((p) => gitAssetMap.has(p.file)) // 过滤掉 assets 中不存在的条目
      .map((p) => ({
        file: p.file,
        url: this.buildPhotoUrl(contentItemId, p.file),
        size: gitAssetMap.get(p.file) ?? 0,
        caption: p.caption,
        tags: p.tags,
      }));

    return {
      id: contentItemId,
      title: content.latestVersion?.title ?? '',
      prose: parsed.prose,
      photos,
      cover: parsed.cover,
      tags: parsed.tags,
      hasDraft: false,
      draftSavedAt: null,
    };
  }

  /**
   * 读取指定历史版本的画廊内容，返回结构化 GalleryVersionDto（解析 frontmatter）。
   * 用于版本预览——前端不需要知道 frontmatter 格式。
   */
  async getByVersion(
    contentItemId: string,
    commitHash: string,
  ): Promise<GalleryVersionDto> {
    const source = await this.contentRepoService.readContentSource(
      contentItemId,
      { commitHash, scope: 'gallery' },
    );
    const parsed = parseGalleryContent(source.bodyMarkdown);

    /* 标题从 MongoDB changeLogs 里找（commitHash 匹配的那条），否则回退 latestVersion */
    const content = await this.contentRepository.findById(contentItemId);
    const changeLog = content?.changeLogs.find((c) => c.commitHash === commitHash);
    const title = changeLog?.title ?? content?.latestVersion?.title ?? '';

    return {
      commitHash,
      title,
      prose: parsed.prose,
      photos: parsed.photos,
      cover: parsed.cover,
      tags: parsed.tags,
    };
  }

  /** 直接读取照片文件 buffer，用于文件直出端点。支持 commitHash 读取历史版本资源。 */
  async readPhotoBuffer(
    contentItemId: string,
    fileName: string,
    commitHash?: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.contentRepoService.readAssetBuffer(contentItemId, fileName, commitHash);
  }

  /**
   * 将画廊保存 DTO 序列化为 main.md 格式（frontmatter + prose）。
   * 集中封装序列化逻辑，commitPost / saveDraft 均调此方法，确保格式一致。
   */
  private serializeDto(dto: SaveGalleryPostDto): string {
    const photos = (dto.photos ?? []).map((p) => ({
      file: p.file,
      caption: p.caption,
      tags: p.tags ?? {},
    }));
    return serializeGalleryContent({
      photos,
      cover: dto.cover ?? null,
      tags: dto.tags ?? {},
      prose: dto.prose,
    });
  }

  /**
   * 正式提交画廊帖子：
   * 1. 将 MinIO 草稿照片物化到 Git assets 目录
   * 2. 将结构化 DTO 序列化为 main.md 后调 ContentService 写入 Git
   * 3. 提交成功后清理 MinIO 草稿照片
   *
   * 返回更新后的画廊详情 DTO，前端不感知 frontmatter 的存在。
   */
  async commitPost(contentItemId: string, dto: SaveGalleryPostDto): Promise<GalleryAdminDetailDto> {
    // 1. 将 MinIO 草稿照片下载到 Git assets 目录
    const assetsDir = join(
      this.contentRepoService.getContentDirectoryPath(contentItemId),
      'assets',
    );
    const materialized = await this.minioService.moveDraftAssetsToDisk(
      contentItemId,
      assetsDir,
    );

    // 2. 序列化 frontmatter + prose → main.md
    const bodyMarkdown = this.serializeDto(dto);

    // 3. 写入 Git
    await this.contentService.saveContent(contentItemId, {
      title: dto.title,
      summary: dto.title,
      bodyMarkdown,
      changeNote: dto.changeNote ?? '提交',
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
    });

    // 4. 提交成功后清理 MinIO 草稿照片
    if (materialized.length > 0) {
      await this.minioService.deleteDraftAssets(contentItemId);
    }

    return this.toAdminDetailDto(contentItemId);
  }

  /**
   * 保存画廊草稿：只写 MongoDB，不触发 Git commit。
   * 序列化在后端完成，前端只发结构化 JSON。
   */
  async saveDraft(contentItemId: string, dto: SaveGalleryPostDto): Promise<GalleryDraftDto> {
    await this.contentService.assertContentEditable(contentItemId);
    const bodyMarkdown = this.serializeDto(dto);
    const draft = await this.editorDraftRepository.save({
      contentItemId,
      title: dto.title,
      summary: dto.title,
      bodyMarkdown,
      changeNote: '自动保存',
      savedAt: new Date(),
    });

    // 将草稿反序列化为结构化字段，返回给前端（前端不需要 bodyMarkdown）
    const parsed = parseGalleryContent(draft.bodyMarkdown);
    return {
      title: draft.title,
      prose: parsed.prose,
      photos: parsed.photos,
      cover: parsed.cover,
      tags: parsed.tags,
      savedAt: draft.savedAt.toISOString(),
    };
  }

  /**
   * 获取画廊草稿：将存储的 bodyMarkdown 反序列化为结构化字段返回给前端。
   * 无草稿时返回 null（200），与 NoteViewService.getDraft 行为一致，避免 404 污染浏览器 console。
   */
  async getDraft(contentItemId: string): Promise<GalleryDraftDto | null> {
    await this.contentService.assertContentItemExists(contentItemId);
    const draft = await this.editorDraftRepository.findByContentItemId(contentItemId);
    if (!draft) return null;

    const parsed = parseGalleryContent(draft.bodyMarkdown);
    return {
      title: draft.title,
      prose: parsed.prose,
      photos: parsed.photos,
      cover: parsed.cover,
      tags: parsed.tags,
      savedAt: draft.savedAt.toISOString(),
    };
  }

  /** 删除画廊草稿（提交后清理），同步清理 MinIO 中的草稿照片。 */
  async deleteDraft(contentItemId: string): Promise<void> {
    await this.editorDraftRepository.deleteByContentItemId(contentItemId);
    await this.minioService.deleteDraftAssets(contentItemId);
  }

  // ─── 草稿照片（MinIO 临时存储）───

  /** 文件名消毒：小写 + 去特殊字符 + 追加 uuid8 后缀防冲突。 */
  private sanitizeFileName(original: string): string {
    const parsed = parse(original);
    const baseName = parsed.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const safeBaseName = baseName || 'photo';
    const extension = extname(parsed.base).toLowerCase();
    const suffix = randomUUID().slice(0, 8);
    return `${safeBaseName}-${suffix}${extension}`;
  }

  /** 上传草稿照片到 MinIO，返回代理预览 URL。 */
  async uploadDraftPhoto(
    contentItemId: string,
    input: { originalFileName: string; contentType: string; buffer: Buffer },
  ): Promise<{ url: string; fileName: string; size: number }> {
    await this.contentService.assertContentItemExists(contentItemId);
    const fileName = this.sanitizeFileName(input.originalFileName);
    await this.minioService.uploadDraftAsset(
      contentItemId,
      fileName,
      input.buffer,
      input.contentType,
    );
    return {
      url: `/api/v1/spaces/gallery/items/${contentItemId}/draft-assets/${fileName}`,
      fileName,
      size: input.buffer.byteLength,
    };
  }

  /** 代理返回 MinIO 中的草稿照片。 */
  async getDraftPhoto(
    contentItemId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.minioService.getDraftAsset(contentItemId, fileName);
  }
}
