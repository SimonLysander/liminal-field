/**
 * GalleryViewService — 画廊 scope 的特有逻辑。
 *
 * 架构变更（frontmatter 协议迁移）：
 * 元数据存储从 MongoDB gallery_post_meta 集合迁移至 main.md 的 YAML frontmatter。
 * frontmatter 格式（新）：
 *   date: "2024-03-15"             # 拍摄/发生日期（可选，一级字段）
 *   location: 北京                  # 地点（可选，一级字段）
 *   cover: photo-xxx.jpg          # 封面图文件名（可选）
 *   photos:                        # 照片顺序/描述列表（可选）
 *     - file: photo-xxx.jpg
 *       caption: 老胡同里的光影
 *       tags:
 *         camera: GR III
 *
 * 旧数据兼容：如果有 tags.location 但没有一级 location，自动从 tags 迁移。
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
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { join, parse, extname } from 'path';
import * as yaml from 'js-yaml';
import { ContentRepository } from '../content/content.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
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
import { OssService } from '../oss/oss.service';
import { NavigationRepository } from '../navigation/navigation.repository';
import { NavigationNodeType } from '../navigation/navigation.entity';

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
  /** 帖子拍摄/发生日期（ISO 8601），null 表示未设置。 */
  date: string | null;
  /** 帖子地点，null 表示未设置。 */
  location: string | null;
  prose: string;
  /** 原始内容是否包含 frontmatter。无 frontmatter 的旧数据需要从 assets 推断照片列表。 */
  hasFrontmatter: boolean;
}

/**
 * 解析 main.md 原始字符串，提取 YAML frontmatter 和随笔正文。
 *
 * 边界情况：
 * - 无 frontmatter（旧数据兼容）→ photos=[], date=null, location=null, cover=null，整体内容当 prose
 * - frontmatter 中 photos 字段缺失或为空 → 默认 []
 * - frontmatter 中 cover 字段缺失 → null
 * - 旧数据兼容：如果有 tags.location 但没有一级 location，自动从 tags 迁移
 *
 * export 供单元测试直接调用，不影响运行时封装。
 */
export function parseGalleryContent(raw: string): ParsedGalleryContent {
  // frontmatter 必须以 "---\n" 开头，否则视为无 frontmatter
  if (!raw.startsWith('---')) {
    return {
      photos: [],
      cover: null,
      date: null,
      location: null,
      prose: raw,
      hasFrontmatter: false,
    };
  }

  // 找到第二个 "---" 分隔符的位置（跳过开头的 "---"）
  const closingMarkerIndex = raw.indexOf('\n---', 3);
  if (closingMarkerIndex === -1) {
    // 只有开头的 "---"，没有关闭标记，视为无 frontmatter
    return {
      photos: [],
      cover: null,
      date: null,
      location: null,
      prose: raw,
      hasFrontmatter: false,
    };
  }

  const yamlContent = raw.slice(4, closingMarkerIndex); // "---\n" 之后到关闭 "---" 之前
  const prose = raw.slice(closingMarkerIndex + 4).trimStart(); // 关闭 "---\n" 之后的内容

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    // YAML 解析失败，降级为无 frontmatter
    return {
      photos: [],
      cover: null,
      date: null,
      location: null,
      prose: raw,
      hasFrontmatter: false,
    };
  }

  // 提取 cover（字符串或 null）
  const cover = typeof parsed.cover === 'string' ? parsed.cover : null;

  // 提取 date（字符串或 null）
  const date = typeof parsed.date === 'string' ? parsed.date : null;

  // 提取 location：优先读一级字段，旧数据兼容从 tags.location 迁移
  let location: string | null =
    typeof parsed.location === 'string' ? parsed.location : null;
  if (
    location === null &&
    parsed.tags !== null &&
    typeof parsed.tags === 'object' &&
    !Array.isArray(parsed.tags)
  ) {
    const tagsObj = parsed.tags as Record<string, unknown>;
    if (typeof tagsObj.location === 'string') {
      location = tagsObj.location;
    }
  }

  // 提取 photos 数组，逐项规范化
  const rawPhotos = Array.isArray(parsed.photos) ? parsed.photos : [];
  const photos: FrontmatterPhoto[] = rawPhotos
    .filter(
      (p): p is Record<string, unknown> => p !== null && typeof p === 'object',
    )
    .map((p) => ({
      file: typeof p.file === 'string' ? p.file : '',
      caption: typeof p.caption === 'string' ? p.caption : '',
      tags: parseTags(p.tags),
    }))
    .filter((p) => p.file !== ''); // 过滤掉 file 字段缺失的条目

  return { photos, cover, date, location, prose, hasFrontmatter: true };
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
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        typeof v === 'bigint'
      ) {
        result[k] = String(v);
      }
    }
  }
  return result;
}

/**
 * 将解析后的内容序列化为 main.md 字符串（frontmatter + prose）。
 * 始终生成 frontmatter（即使 photos 为空），确保 parseGalleryContent 能识别 hasFrontmatter=true。
 * 这对于"用户显式清空照片"的场景至关重要——没有 frontmatter 会触发旧数据兼容逻辑，
 * 从 assets 目录推断照片列表，导致已删除的照片重新出现。
 *
 * frontmatter 字段顺序：date → location → cover → photos。
 */
export function serializeGalleryContent(data: {
  photos: FrontmatterPhoto[];
  cover: string | null;
  date: string | null;
  location: string | null;
  prose: string;
}): string {
  const frontmatterObj: Record<string, unknown> = {};
  if (data.date) frontmatterObj.date = data.date;
  if (data.location) frontmatterObj.location = data.location;
  if (data.cover !== null) frontmatterObj.cover = data.cover;
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
  private readonly logger = new Logger(GalleryViewService.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentService: ContentService,
    private readonly editorDraftRepository: EditorDraftRepository,
    private readonly minioService: OssService,
    private readonly navigationRepository: NavigationRepository,
    private readonly snapshotRepository: ContentSnapshotRepository,
  ) {}

  /** 构建照片的统一访问 URL（走 /spaces/gallery/items/:id/assets/:fileName）。 */
  /**
   * 构建图片 URL：优先使用 OSS 直连（带图片处理参数），
   * OSS 未就绪时降级为 NestJS 代理。
   */
  private buildPhotoUrl(
    contentItemId: string,
    fileName: string,
    process?: string,
  ): string {
    if (this.minioService.isDraftStorageReady()) {
      return this.minioService.getPublicUrl(
        `assets/${contentItemId}/${fileName}`,
        process,
      );
    }
    // OSS 未就绪降级为代理
    return `/api/v1/spaces/gallery/items/${contentItemId}/assets/${fileName}`;
  }

  /** 拼接版本号用于缓存破坏（兼容 OSS URL 已有 ? 的情况） */
  private appendVersion(url: string, version?: string | null): string {
    if (!version) return url;
    return url.includes('?') ? `${url}&v=${version}` : `${url}?v=${version}`;
  }

  /**
   * V2 发布前校验：从 ContentSnapshot 读取目标版本，检查是否有照片。
   * @param versionId 要发布的版本（nanoid），不传则检查最新版本。
   */
  async assertPublishable(
    contentItemId: string,
    versionId?: string,
  ): Promise<void> {
    const content = await this.contentRepository.findById(contentItemId);
    const targetVersionId = versionId ?? content?.latestVersion?.versionId;

    const { parsed } = await this.loadParsedContent(
      contentItemId,
      targetVersionId,
    );

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
   * 从 ContentSnapshot 加载并解析 frontmatter，同时返回磁盘 assets 中的图片列表。
   *
   * V2 读路径变更：正文改从 ContentSnapshot 读取，不再走 git show / fs.readFile。
   * 资产列表暂时仍从磁盘读取（Phase 1 接入 OSS 后替换）。
   *
   * @param versionId 快照版本标识，不传时返回空内容（刚创建尚无快照的情况）。
   */
  private async loadParsedContent(
    contentItemId: string,
    versionId?: string,
  ): Promise<{
    parsed: ParsedGalleryContent;
    imageAssets: Awaited<ReturnType<ContentRepoService['listAssets']>>;
  }> {
    // 从快照读取正文；无 versionId（内容刚创建）时降级为空
    let bodyMarkdown = '';
    if (versionId) {
      const snapshot = await this.snapshotRepository.findByVersionId(versionId);
      if (snapshot) {
        bodyMarkdown = snapshot.bodyMarkdown;
      } else {
        this.logger.warn(
          `loadParsedContent: 快照 ${versionId} 不存在 (contentItemId=${contentItemId})，返回空内容`,
        );
      }
    }

    const [parsed, assets] = await Promise.all([
      Promise.resolve(parseGalleryContent(bodyMarkdown)),
      this.contentRepoService.listAssets(contentItemId),
    ]);
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
    preset = OssService.IMAGE_PRESETS.detail,
  ): GalleryPhotoDto[] {
    // frontmatter 中登记的照片（按 frontmatter 顺序）
    // OSS 就绪时信任 frontmatter（资源已在 OSS 永久 key 上），不要求磁盘存在
    const useOss = this.minioService.isDraftStorageReady();
    const registeredPhotos: GalleryPhotoDto[] = parsedPhotos
      .map((p) => {
        const asset = imageAssets.find((a) => a.fileName === p.file);
        // 磁盘和 OSS 都不可用时才跳过
        if (!asset && !useOss) return null;
        return {
          id: p.file,
          url: this.buildPhotoUrl(contentItemId, p.file, preset),
          originalUrl: this.buildPhotoUrl(contentItemId, p.file),
          fileName: p.file,
          size: asset?.size ?? 0,
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
      url: this.buildPhotoUrl(contentItemId, asset.fileName, preset),
      originalUrl: this.buildPhotoUrl(contentItemId, asset.fileName),
      fileName: asset.fileName,
      size: asset.size,
      caption: '',
      tags: {},
    }));
  }

  /**
   * 展示端列表 DTO：从已发布版本读取，确保展示的是发布时的快照。
   */
  async toPublicListItemDto(
    contentItemId: string,
  ): Promise<GalleryPublicListItemDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);
    if (!content.publishedVersion)
      throw new NotFoundException(
        `Gallery post ${contentItemId} is not published`,
      );

    // V2: 用 versionId 从快照读取已发布版本内容，替代 commitHash + git show
    const publishedVersionId = content.publishedVersion.versionId;
    const { parsed, imageAssets } = await this.loadParsedContent(
      contentItemId,
      publishedVersionId,
    );

    // 封面优先级：frontmatter.cover 指定的文件 > assets 首图；与 toAdminListItemDto 逻辑保持一致
    const coverFileName = parsed.cover ?? null;
    const coverAsset = coverFileName
      ? (imageAssets.find((a) => a.fileName === coverFileName) ??
        imageAssets[0])
      : imageAssets[0];

    const version = content.publishedVersion;

    return {
      id: contentItemId,
      title: version.title,
      coverUrl: coverAsset
        ? this.appendVersion(
            this.buildPhotoUrl(
              contentItemId,
              coverAsset.fileName,
              OssService.IMAGE_PRESETS.cover,
            ),
            publishedVersionId,
          )
        : null,
      date: parsed.date,
      location: parsed.location,
      createdAt: content.createdAt.toISOString(),
    };
  }

  /**
   * 管理端列表 DTO：含封面图、照片计数、发布状态等管理所需字段。
   * 元数据来源：main.md YAML frontmatter（cover、tags、photos）。
   * 封面优先级：frontmatter.cover > assets 首图。
   */
  async toAdminListItemDto(
    contentItemId: string,
  ): Promise<GalleryAdminListItemDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    // V2: 用 latestVersion.versionId 从快照读取最新版本内容
    const { parsed, imageAssets } = await this.loadParsedContent(
      contentItemId,
      content.latestVersion?.versionId,
    );

    // 封面图：frontmatter.cover 指定的文件必须存在于 assets，否则退化为首图
    const coverFileName = parsed.cover ?? null;
    const coverAsset = coverFileName
      ? (imageAssets.find((a) => a.fileName === coverFileName) ??
        imageAssets[0])
      : imageAssets[0];

    const version = content.latestVersion!;

    return {
      id: contentItemId,
      title: version.title,
      status: content.publishedVersion ? 'published' : 'committed',
      coverUrl: coverAsset
        ? this.buildPhotoUrl(
            contentItemId,
            coverAsset.fileName,
            OssService.IMAGE_PRESETS.thumbnail,
          )
        : null,
      photoCount: imageAssets.length,
      // V2: 用 versionId 比较（commitHash 异步回填，可能延迟）
      hasUnpublishedChanges: content.publishedVersion
        ? content.latestVersion?.versionId !==
          content.publishedVersion?.versionId
        : false,
      date: parsed.date,
      location: parsed.location,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  /**
   * 展示端详情 DTO：从已发布版本的 commit 读取内容，确保展示的是发布时的快照。
   * 不含管理字段（封面文件名、publishedCommitHash 等）。
   */
  async toPublicDetailDto(
    contentItemId: string,
  ): Promise<GalleryPublicDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);
    if (!content.publishedVersion)
      throw new NotFoundException(
        `Gallery post ${contentItemId} is not published`,
      );

    // V2: 用 versionId 从快照读取已发布版本内容，替代 commitHash + git show
    const publishedVersionId = content.publishedVersion.versionId;
    const { parsed, imageAssets } = await this.loadParsedContent(
      contentItemId,
      publishedVersionId,
    );
    const photos = this.buildPhotoList(
      contentItemId,
      parsed.photos,
      imageAssets,
      parsed.hasFrontmatter,
      OssService.IMAGE_PRESETS.full, // 公开画廊全屏轮播用最高质量
    );

    // 展示端照片 URL 带版本号（签名 URL 已有 ? 时用 &v=）
    const versionedPhotos = publishedVersionId
      ? photos.map((p) => ({
          ...p,
          url: this.appendVersion(p.url, publishedVersionId),
        }))
      : photos;

    return {
      id: contentItemId,
      title: content.publishedVersion.title,
      prose: parsed.prose,
      photos: versionedPhotos,
      date: parsed.date,
      location: parsed.location,
      createdAt: content.createdAt.toISOString(),
    };
  }

  /**
   * 管理端详情 DTO：含封面文件名、publishedCommitHash 等管理所需字段。
   */
  async toAdminDetailDto(
    contentItemId: string,
  ): Promise<GalleryAdminDetailDto> {
    const content = await this.contentRepository.findById(contentItemId);
    if (!content)
      throw new NotFoundException(`Gallery post ${contentItemId} not found`);

    // V2: 用 latestVersion.versionId 从快照读取最新版本内容
    const { parsed, imageAssets } = await this.loadParsedContent(
      contentItemId,
      content.latestVersion?.versionId,
    );
    const photos = this.buildPhotoList(
      contentItemId,
      parsed.photos,
      imageAssets,
      parsed.hasFrontmatter,
    );
    const version = content.latestVersion!;

    return {
      id: contentItemId,
      title: version.title,
      prose: parsed.prose,
      status: content.publishedVersion ? 'published' : 'committed',
      photos,
      coverPhotoFileName: parsed.cover,
      // V2: 用 versionId 比较（commitHash 异步回填，可能延迟）
      hasUnpublishedChanges: content.publishedVersion
        ? content.latestVersion?.versionId !==
          content.publishedVersion?.versionId
        : false,
      publishedCommitHash: content.publishedVersion?.commitHash ?? null,
      date: parsed.date,
      location: parsed.location,
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
        // 已提交到 Git/磁盘的照片用永久 URL；草稿新增的照片用 draft URL（OSS 草稿路径）
        const url =
          gitSize !== undefined
            ? this.buildPhotoUrl(
                contentItemId,
                p.file,
                OssService.IMAGE_PRESETS.detail,
              )
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
        date: parsed.date,
        location: parsed.location,
        hasDraft: true,
        draftSavedAt: draft.savedAt.toISOString(),
      };
    }

    // 无草稿：从最新版本快照读取正式版数据（V2：不再读磁盘文件）
    const latestVersionId = content.latestVersion?.versionId;
    let parsed: ParsedGalleryContent = {
      photos: [],
      cover: null,
      date: null,
      location: null,
      prose: '',
      hasFrontmatter: false,
    };
    if (latestVersionId) {
      const snapshot =
        await this.snapshotRepository.findByVersionId(latestVersionId);
      if (snapshot) {
        parsed = parseGalleryContent(snapshot.bodyMarkdown);
      } else {
        this.logger.warn(
          `getEditorState: 快照 ${latestVersionId} 不存在 (contentItemId=${contentItemId})，使用默认空值`,
        );
      }
    }

    const useOss = this.minioService.isDraftStorageReady();
    const photos: GalleryEditorPhotoDto[] = parsed.photos
      .filter((p) => gitAssetMap.has(p.file) || useOss)
      .map((p) => ({
        file: p.file,
        url: this.buildPhotoUrl(
          contentItemId,
          p.file,
          OssService.IMAGE_PRESETS.detail,
        ),
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
      date: parsed.date,
      location: parsed.location,
      hasDraft: false,
      draftSavedAt: null,
    };
  }

  /**
   * V2: 从 ContentSnapshot 读取历史版本，返回结构化 GalleryVersionDto。
   * versionOrHash 可以是 versionId（nanoid）或 commitHash（兼容旧数据）。
   */
  async getByVersion(
    contentItemId: string,
    versionOrHash: string,
  ): Promise<GalleryVersionDto> {
    // 优先按 versionId 查 snapshot
    let snapshot = await this.snapshotRepository.findByVersionId(versionOrHash);
    if (!snapshot) {
      const snapshots =
        await this.snapshotRepository.listByContentItemId(contentItemId);
      snapshot = snapshots.find((s) => s.commitHash === versionOrHash) ?? null;
    }

    let bodyMarkdown: string;
    let title: string;

    if (snapshot) {
      bodyMarkdown = snapshot.bodyMarkdown;
      title = snapshot.title;
    } else {
      // 最终 fallback：Git（兼容旧数据）
      const source = await this.contentRepoService.readContentSource(
        contentItemId,
        { commitHash: versionOrHash, scope: 'gallery' },
      );
      bodyMarkdown = source.bodyMarkdown;
      const content = await this.contentRepository.findById(contentItemId);
      title = content?.latestVersion?.title ?? '';
    }

    const parsed = parseGalleryContent(bodyMarkdown);
    return {
      versionId: snapshot?.versionId ?? versionOrHash,
      title,
      prose: parsed.prose,
      photos: parsed.photos,
      cover: parsed.cover,
      date: parsed.date,
      location: parsed.location,
    };
  }

  /**
   * V2: 读取照片文件，优先磁盘，磁盘未命中时回退 OSS draft/ 路径。
   * 草稿照片提交后异步下载到磁盘，在此期间从 OSS 直接读取避免 404。
   */
  async readPhotoBuffer(
    contentItemId: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    try {
      return await this.contentRepoService.readAssetBuffer(
        contentItemId,
        fileName,
      );
    } catch {
      // 磁盘未命中（异步归档尚未完成），回退 OSS draft 路径
      const ossKey = `draft/${contentItemId}/${fileName}`;
      const buffer = await this.minioService.getObject(ossKey);
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        gif: 'image/gif',
      };
      return {
        buffer,
        contentType: mimeMap[ext] ?? 'application/octet-stream',
      };
    }
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
      date: dto.date ?? null,
      location: dto.location ?? null,
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
  async commitPost(
    contentItemId: string,
    dto: SaveGalleryPostDto,
  ): Promise<GalleryAdminDetailDto> {
    // V2: 草稿照片下载到磁盘 + 清理 OSS 改为异步，不阻塞提交请求。
    // 照片在 OSS draft/{id}/ 下仍可访问，serveAsset 磁盘未命中时回退 OSS。

    // 1. 序列化 frontmatter + prose → main.md
    const bodyMarkdown = this.serializeDto(dto);

    // 2. 写入 ContentSnapshot + ContentItem（同步），Git 后台异步归档
    await this.contentService.saveContent(contentItemId, {
      title: dto.title,
      summary: dto.title,
      bodyMarkdown,
      changeNote: dto.changeNote ?? '提交',
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
    });

    // 3. OSS 内部拷贝到永久位置（同步，确保返回 DTO 时 URL 可访问）
    await this.minioService.promoteDraftAssets(contentItemId).catch(() => {});

    // 4. 后台：下载到磁盘 + Git 归档 + 清理 OSS draft
    void this.archiveDraftAssets(contentItemId).catch((err: unknown) => {
      this.logger.warn(
        `archiveDraftAssets failed for ${contentItemId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return this.toAdminDetailDto(contentItemId);
  }

  /**
   * 保存画廊草稿：只写 MongoDB，不触发 Git commit。
   * V2: 后台将草稿照片从 OSS 下载到磁盘（供 Git 归档），完成后清理 OSS 草稿。
   * fire-and-forget，失败不影响用户操作。
   */
  private async archiveDraftAssets(contentItemId: string): Promise<void> {
    // 先提升到 OSS 永久位置（内部拷贝），再下载到磁盘
    await this.minioService.promoteDraftAssets(contentItemId).catch(() => {});
    const assetsDir = join(
      this.contentRepoService.getContentDirectoryPath(contentItemId),
      'assets',
    );
    const materialized = await this.minioService.moveDraftAssetsToDisk(
      contentItemId,
      assetsDir,
    );
    if (materialized.length > 0) {
      await this.minioService.deleteDraftAssets(contentItemId);
      this.logger.log(
        `Archived ${materialized.length} draft assets for ${contentItemId}`,
      );
    }
  }

  /**
   * 序列化在后端完成，前端只发结构化 JSON。
   */
  async saveDraft(
    contentItemId: string,
    dto: SaveGalleryPostDto,
  ): Promise<GalleryDraftDto> {
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
      date: parsed.date,
      location: parsed.location,
      savedAt: draft.savedAt.toISOString(),
    };
  }

  /**
   * 获取画廊草稿：将存储的 bodyMarkdown 反序列化为结构化字段返回给前端。
   * 无草稿时返回 null（200），与 NoteViewService.getDraft 行为一致，避免 404 污染浏览器 console。
   */
  async getDraft(contentItemId: string): Promise<GalleryDraftDto | null> {
    await this.contentService.assertContentItemExists(contentItemId);
    const draft =
      await this.editorDraftRepository.findByContentItemId(contentItemId);
    if (!draft) return null;

    const parsed = parseGalleryContent(draft.bodyMarkdown);
    return {
      title: draft.title,
      prose: parsed.prose,
      photos: parsed.photos,
      cover: parsed.cover,
      date: parsed.date,
      location: parsed.location,
      savedAt: draft.savedAt.toISOString(),
    };
  }

  /** 删除画廊草稿（提交后清理），同步清理 MinIO 中的草稿照片。 */
  async deleteDraft(contentItemId: string): Promise<void> {
    await this.editorDraftRepository.deleteByContentItemId(contentItemId);
    await this.minioService.deleteDraftAssets(contentItemId);
  }

  /**
   * 首页用：返回最近 N 个已发布 gallery 条目的展示端列表 DTO。
   *
   * 实现方式：从导航索引取 gallery scope 所有节点，逐一检查 publishedVersion，
   * 映射为 PublicListItemDto 后按 createdAt 倒序截取前 limit 条。
   * 与 WorkspaceController.list('gallery', 'published') 逻辑对齐，避免重复实现查询路径。
   */
  async listPublishedForHome(
    limit: number,
  ): Promise<GalleryPublicListItemDto[]> {
    // 取 gallery scope 所有导航节点，过滤出有 contentItemId 的条目
    const nodes = await this.navigationRepository.findRootNodes('gallery');
    const contentNodes = nodes.filter(
      (n) => n.nodeType === NavigationNodeType.content && n.contentItemId,
    );

    const dtos: GalleryPublicListItemDto[] = [];
    for (const node of contentNodes) {
      // 只处理已发布的内容
      const content = await this.contentRepository.findById(
        node.contentItemId!,
      );
      if (!content?.publishedVersion) continue;

      try {
        const dto = await this.toPublicListItemDto(node.contentItemId!);
        dtos.push(dto);
      } catch (error) {
        // 个别条目加载失败不阻断整体列表（如 git 资源缺失等边缘情况）
        this.logger.warn(
          `listPublishedForHome: 跳过条目 ${node.contentItemId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 按 createdAt 倒序（最新的在前）后截取 limit 条
    return dtos
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  // ─── 草稿照片（MinIO 临时存储）───

  /** 文件名消毒：小写 + 去特殊字符 + 追加 uuid8 后缀防冲突。 */
  private sanitizeFileName(original: string): string {
    const parsed = parse(original);
    // toLowerCase() 之后字符串不含大写字母，正则无需保留 A-Z
    const baseName = parsed.name
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const safeBaseName = baseName || 'photo';
    const extension = extname(parsed.base).toLowerCase();
    const suffix = randomUUID().slice(0, 8);
    return `${safeBaseName}-${suffix}${extension}`;
  }

  /**
   * 从图片 buffer 提取 EXIF 元数据，返回前端可直接使用的 tags 结构。
   * JPEG/HEIC 通常包含完整 EXIF，PNG/WebP 通常没有。提取失败时返回空对象。
   */
  private async extractExif(buffer: Buffer): Promise<Record<string, string>> {
    try {
      const exifrMod = (await import('exifr')) as {
        default: {
          parse: (
            buf: Buffer,
            opts?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      const raw = await exifrMod.default.parse(buffer, {
        pick: [
          'Make',
          'Model',
          'FNumber',
          'ExposureTime',
          'ISO',
          'FocalLength',
          'DateTimeOriginal',
          'LensModel',
          'ExifImageWidth',
          'ExifImageHeight',
        ],
      });
      if (!raw || typeof raw !== 'object') return {};

      const data = raw as Record<string, unknown>;
      const num = (k: string): number | undefined => {
        const v = data[k];
        return typeof v === 'number' && !Number.isNaN(v) ? v : undefined;
      };
      const str = (k: string): string | undefined => {
        const v = data[k];
        return typeof v === 'string' ? v : undefined;
      };

      const tags: Record<string, string> = {};
      const device = [str('Make'), str('Model')]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (device) tags.device = device;

      const fNumber = num('FNumber');
      if (fNumber !== undefined) tags.aperture = `f/${fNumber}`;

      const exposure = num('ExposureTime');
      if (exposure !== undefined) {
        tags.shutter =
          exposure >= 1 ? `${exposure}s` : `1/${Math.round(1 / exposure)}s`;
      }

      const iso = num('ISO');
      if (iso !== undefined) tags.iso = String(iso);

      const focal = num('FocalLength');
      if (focal !== undefined) tags.focalLength = `${Math.round(focal)}mm`;

      const dto = data['DateTimeOriginal'];
      if (dto !== undefined && dto !== null) {
        const d = new Date(dto as string | number | Date);
        if (!isNaN(d.getTime())) {
          tags.shotAt = d.toISOString().slice(0, 10);
        }
      }

      const lens = str('LensModel');
      if (lens) tags.lens = lens;

      const w = num('ExifImageWidth');
      const h = num('ExifImageHeight');
      if (w !== undefined && h !== undefined) {
        tags.width = String(w);
        tags.height = String(h);
      }

      return tags;
    } catch (err: unknown) {
      // PNG/WebP 通常没有 EXIF，提取失败属于正常情况；JPEG 失败时记录以便排查
      this.logger.warn(
        `extractExif: EXIF 提取失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
  }

  /**
   * 上传草稿照片到 OSS，提取 EXIF 元数据，返回预览 URL + 自动提取的 tags。
   *
   * URL 策略（减少网格流量）：
   * - OSS 就绪时：url = 400px 缩略图签名 URL（直连 OSS，网格使用）；
   *               originalUrl = 代理 URL（走 NestJS，供编辑器大图预览）
   * - OSS 未就绪：url = originalUrl = 代理 URL（本地开发降级）
   *
   * 草稿对象在 OSS 的 key 格式：{contentItemId}/{fileName}（无 draft/ 前缀）。
   */
  async uploadDraftPhoto(
    contentItemId: string,
    input: { originalFileName: string; contentType: string; buffer: Buffer },
  ): Promise<{
    url: string;
    originalUrl: string;
    fileName: string;
    size: number;
    exif: Record<string, string>;
  }> {
    await this.contentService.assertContentItemExists(contentItemId);
    const fileName = this.sanitizeFileName(input.originalFileName);

    // 并行：上传 OSS + 提取 EXIF
    const [, exif] = await Promise.all([
      this.minioService.uploadDraftAsset(
        contentItemId,
        fileName,
        input.buffer,
        input.contentType,
      ),
      this.extractExif(input.buffer),
    ]);

    // 代理 URL（无论 OSS 是否就绪，originalUrl 始终是安全的代理地址）
    const proxyUrl = `/api/v1/spaces/gallery/items/${contentItemId}/draft-assets/${fileName}`;

    // 网格缩略图 URL：OSS 就绪时返回 400px 直连签名 URL，否则降级代理
    const thumbnailUrl = this.minioService.isDraftStorageReady()
      ? this.minioService.getPublicUrl(
          `${contentItemId}/${fileName}`,
          OssService.IMAGE_PRESETS.cover, // image/resize,w_400/format,webp
        )
      : proxyUrl;

    return {
      url: thumbnailUrl,
      originalUrl: proxyUrl,
      fileName,
      size: input.buffer.byteLength,
      exif,
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
