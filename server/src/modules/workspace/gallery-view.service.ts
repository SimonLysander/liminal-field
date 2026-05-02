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
import { Injectable, NotFoundException } from '@nestjs/common';
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
  GalleryPostDto,
  GalleryPostDetailDto,
  GalleryDraftDto,
} from './dto/gallery-view.dto';
import { EditorDraftRepository } from './editor-draft.repository';
import { SaveGalleryPostDto } from './dto/save-gallery-post.dto';
import { MinioService } from '../minio/minio.service';

// 列表页最多显示的预览图数量。
const PREVIEW_PHOTO_LIMIT = 9;

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
}

/**
 * 解析 main.md 原始字符串，提取 YAML frontmatter 和随笔正文。
 *
 * 边界情况：
 * - 无 frontmatter（旧数据兼容）→ photos=[], tags={}, cover=null，整体内容当 prose
 * - frontmatter 中 photos 字段缺失或为空 → 默认 []
 * - frontmatter 中 cover 字段缺失 → null
 */
function parseGalleryContent(raw: string): ParsedGalleryContent {
  // frontmatter 必须以 "---\n" 开头，否则视为无 frontmatter
  if (!raw.startsWith('---')) {
    return { photos: [], cover: null, tags: {}, prose: raw };
  }

  // 找到第二个 "---" 分隔符的位置（跳过开头的 "---"）
  const closingMarkerIndex = raw.indexOf('\n---', 3);
  if (closingMarkerIndex === -1) {
    // 只有开头的 "---"，没有关闭标记，视为无 frontmatter
    return { photos: [], cover: null, tags: {}, prose: raw };
  }

  const yamlContent = raw.slice(4, closingMarkerIndex); // "---\n" 之后到关闭 "---" 之前
  const prose = raw.slice(closingMarkerIndex + 4).trimStart(); // 关闭 "---\n" 之后的内容

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    // YAML 解析失败，降级为无 frontmatter
    return { photos: [], cover: null, tags: {}, prose: raw };
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

  return { photos, cover, tags, prose };
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
 * 当 photos 为空且 cover 为 null 且 tags 为空时，不生成 frontmatter，直接输出 prose。
 */
export function serializeGalleryContent(data: {
  photos: FrontmatterPhoto[];
  cover: string | null;
  tags: Record<string, string>;
  prose: string;
}): string {
  const hasFrontmatter =
    data.photos.length > 0 ||
    data.cover !== null ||
    Object.keys(data.tags).length > 0;

  if (!hasFrontmatter) {
    return data.prose;
  }

  const frontmatterObj: Record<string, unknown> = {};
  if (data.cover !== null) frontmatterObj.cover = data.cover;
  if (Object.keys(data.tags).length > 0) frontmatterObj.tags = data.tags;
  if (data.photos.length > 0) {
    frontmatterObj.photos = data.photos.map((p) => ({
      file: p.file,
      caption: p.caption,
      ...(Object.keys(p.tags).length > 0 ? { tags: p.tags } : { tags: {} }),
    }));
  }

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
   * 将 Content 存储层数据转换为画廊列表 DTO。
   *
   * 元数据来源：main.md YAML frontmatter（cover、tags、photos）。
   * 文件列表来源：Git assets 目录（type=image 过滤）。
   * 封面优先级：frontmatter.cover > assets 首图。
   */
  async toPostDto(contentItemId: string): Promise<GalleryPostDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    const assets = await this.contentRepoService.listAssets(contentItemId);
    const imageAssets = assets.filter((a) => a.type === 'image');

    // 读取并解析 main.md（处理文件不存在的旧数据场景）
    let parsed: ParsedGalleryContent = { photos: [], cover: null, tags: {}, prose: '' };
    try {
      const source = await this.contentRepoService.readContentSource(contentItemId);
      parsed = parseGalleryContent(source.bodyMarkdown);
    } catch {
      // main.md 还不存在（刚创建的条目），使用默认空值
    }

    // 封面图：frontmatter.cover 指定的文件必须存在于 assets，否则退化为首图
    const coverFileName = parsed.cover ?? null;
    const coverAsset = coverFileName
      ? (imageAssets.find((a) => a.fileName === coverFileName) ?? imageAssets[0])
      : imageAssets[0];

    const version = content.latestVersion!;

    // 前 N 张图片 URL，用于列表页缩略图预览
    const previewPhotoUrls = imageAssets
      .slice(0, PREVIEW_PHOTO_LIMIT)
      .map((a) => this.buildPhotoUrl(contentItemId, a.fileName));

    return {
      id: contentItemId,
      title: version.title,
      description: parsed.prose,
      status: content.publishedVersion ? 'published' : 'draft',
      coverUrl: coverAsset
        ? this.buildPhotoUrl(contentItemId, coverAsset.fileName)
        : null,
      photoCount: imageAssets.length,
      tags: parsed.tags,
      coverPhotoFileName: coverFileName,
      previewPhotoUrls,
      publishedCommitHash: content.publishedVersion?.commitHash ?? null,
      hasUnpublishedChanges: content.publishedVersion
        ? content.latestVersion?.commitHash !== content.publishedVersion?.commitHash
        : false,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  /**
   * 画廊详情 DTO：在列表 DTO 基础上追加完整照片列表。
   *
   * 照片排序规则：以 frontmatter photos 数组顺序为准（order = 数组索引）。
   * Git assets 中存在但 frontmatter 未登记的照片，追加到末尾（按 assets 原始顺序）。
   * caption 和 photo 级 tags 从 frontmatter 合并，未登记时默认空值。
   */
  async toPostDetailDto(contentItemId: string): Promise<GalleryPostDetailDto> {
    // 读取文件一次，避免 toPostDto 内部再读一遍（assets 和 source 各读一次）
    const [postDto, assets] = await Promise.all([
      this.toPostDto(contentItemId),
      this.contentRepoService.listAssets(contentItemId),
    ]);

    const imageAssets = assets.filter((a) => a.type === 'image');

    // 重新解析 frontmatter 以获取 photos 顺序信息（toPostDto 已解析，但未暴露）
    // 为避免再次读文件，直接从 main.md 重读一次——成本可接受（Detail 接口低频）
    let parsedPhotos: FrontmatterPhoto[] = [];
    try {
      const source = await this.contentRepoService.readContentSource(contentItemId);
      parsedPhotos = parseGalleryContent(source.bodyMarkdown).photos;
    } catch {
      // 文件不存在，parsedPhotos 保持空数组
    }

    // 构建 fileName -> frontmatterPhoto 查找表（保留 order = frontmatter 中的数组索引）
    const frontmatterByFileName = new Map(
      parsedPhotos.map((p, index) => [p.file, { ...p, order: index }]),
    );

    // 已在 frontmatter 中登记的图片集合，用于识别"新上传但未登记"的照片
    const registeredFileNames = new Set(parsedPhotos.map((p) => p.file));

    // frontmatter 中登记的照片（按 frontmatter 顺序）
    const registeredPhotos: GalleryPhotoDto[] = parsedPhotos
      .map((p, index) => {
        const asset = imageAssets.find((a) => a.fileName === p.file);
        // frontmatter 中登记但 assets 目录中不存在的文件（已被删除），跳过
        if (!asset) return null;
        return {
          id: p.file,
          url: this.buildPhotoUrl(contentItemId, p.file),
          fileName: p.file,
          size: asset.size,
          order: index,
          caption: p.caption,
          tags: p.tags,
        } satisfies GalleryPhotoDto;
      })
      .filter((p): p is GalleryPhotoDto => p !== null);

    // assets 中存在但 frontmatter 未登记的照片，追加到末尾
    const unregisteredPhotos: GalleryPhotoDto[] = imageAssets
      .filter((a) => !registeredFileNames.has(a.fileName))
      .map((asset, fallbackIndex) => ({
        id: asset.fileName,
        url: this.buildPhotoUrl(contentItemId, asset.fileName),
        fileName: asset.fileName,
        size: asset.size,
        order: parsedPhotos.length + fallbackIndex,
        caption: '',
        tags: {},
      }));

    const photos = [...registeredPhotos, ...unregisteredPhotos];

    return { ...postDto, photos };
  }

  /**
   * 读取指定历史版本的画廊内容，返回结构化数据（解析 frontmatter）。
   * 用于版本预览——前端不需要知道 frontmatter 格式。
   */
  async getByVersion(
    contentItemId: string,
    commitHash: string,
  ): Promise<{ commitHash: string; title: string; prose: string; photos: FrontmatterPhoto[]; cover: string | null; tags: Record<string, string> }> {
    const source = await this.contentRepoService.readContentSource(
      contentItemId,
      { commitHash },
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

  /** 直接读取照片文件 buffer，用于文件直出端点。 */
  async readPhotoBuffer(
    contentItemId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.contentRepoService.readAssetBuffer(contentItemId, fileName);
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
   * 正式提交画廊帖子：将结构化 DTO 序列化为 main.md 后调 ContentService 写入 Git。
   * 返回更新后的画廊详情 DTO，前端不感知 frontmatter 的存在。
   */
  async commitPost(contentItemId: string, dto: SaveGalleryPostDto): Promise<GalleryPostDetailDto> {
    const bodyMarkdown = this.serializeDto(dto);
    await this.contentService.saveContent(contentItemId, {
      title: dto.title,
      summary: dto.title,
      bodyMarkdown,
      changeNote: dto.changeNote ?? '提交',
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
    });
    return this.toPostDetailDto(contentItemId);
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
   * 无草稿时抛 NotFoundException（与 NoteViewService.getDraft 的 null 返回不同，
   * 因为画廊草稿由 GalleryViewService 独立管理，统一用异常表达"不存在"）。
   */
  async getDraft(contentItemId: string): Promise<GalleryDraftDto> {
    await this.contentService.assertContentItemExists(contentItemId);
    const draft = await this.editorDraftRepository.findByContentItemId(contentItemId);
    if (!draft) {
      throw new NotFoundException(`Gallery draft for ${contentItemId} not found`);
    }

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

  /** 删除画廊草稿（提交后清理）。 */
  async deleteDraft(contentItemId: string): Promise<void> {
    await this.editorDraftRepository.deleteByContentItemId(contentItemId);
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
