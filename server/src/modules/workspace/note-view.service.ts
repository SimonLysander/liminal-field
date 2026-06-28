/**
 * NoteViewService — 笔记 scope 的特有逻辑。
 *
 * 处理笔记模块独有的功能：
 * - 草稿 CRUD（autosave，不产生 Git 版本）
 * - 版本历史查询（基于 Git commit 记录）
 * - 正式内容保存（编辑器提交，通过 ContentService 写入 Git）
 *
 * frontmatter 协议（新）：
 * - 保存时（saveContent）：给 bodyMarkdown 加上 frontmatter（title 字段）
 * - 读取时（getById/getByVersion）：剥掉 frontmatter，只返回正文给前端（PlateJS 不理解 frontmatter）
 * - 草稿（saveDraft/getDraft）：不加 frontmatter，草稿是编辑器的中间态，不走文件协议
 *
 * 从原 EditorModule（editor.service.ts）迁移而来。
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { join, parse, extname } from 'path';
import { ContentService } from '../content/content.service';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentGitService } from '../content/content-git.service';
import { OssService } from '../oss/oss.service';
import { ContentDetailDto } from '../content/dto/content-detail.dto';
import { ContentListItemDto } from '../content/dto/content-list-item.dto';
import { ContentHistoryEntryDto } from '../content/dto/content-history.dto';
import { ContentVisibility } from '../content/dto/content-query.dto';
import { SaveContentDto } from '../content/dto/save-content.dto';
import { EditorDraftDto } from './dto/editor-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { UploadedAssetDto, ListedAssetDto } from './dto/uploaded-asset.dto';
import { EditorDraft } from './editor-draft.entity';
import { EditorDraftRepository } from './editor-draft.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import { ContentSaveAction } from '../content/dto/save-content.dto';

/**
 * 给 notes bodyMarkdown 加上 frontmatter（只有 title 字段）。
 *
 * 调用场景：saveContent 将编辑器发来的纯 markdown 写入 Git 前调用。
 * 幂等：如果 bodyMarkdown 已经以 "---" 开头，视为已有 frontmatter，直接返回不重复包装。
 */
export function addNoteFrontmatter(
  title: string,
  bodyMarkdown: string,
): string {
  // 已含 frontmatter 的不重复包装（幂等保护）
  if (bodyMarkdown.startsWith('---')) {
    return bodyMarkdown;
  }
  // 用 JSON.stringify 转义 title 中的特殊字符（冒号、引号、# 等），防止 YAML 解析出错
  const safeTitle = JSON.stringify(title);
  return `---\ntitle: ${safeTitle}\n---\n\n${bodyMarkdown}`;
}

/**
 * 剥掉 notes bodyMarkdown 的 frontmatter，返回纯正文和 frontmatter 中的 title。
 *
 * 调用场景：getById/getByVersion 将 snapshot 里的 bodyMarkdown 返回给前端（PlateJS 不理解 frontmatter）。
 * 无 frontmatter 的旧数据：直接返回原文，title 为空字符串（兼容）。
 */
export function stripNoteFrontmatter(bodyMarkdown: string): {
  title: string;
  body: string;
} {
  // 没有 frontmatter → 直接返回原文
  if (!bodyMarkdown.startsWith('---')) {
    return { title: '', body: bodyMarkdown };
  }

  // 找关闭标记 "\n---"（跳过开头的 "---"）
  const closingIndex = bodyMarkdown.indexOf('\n---', 3);
  if (closingIndex === -1) {
    return { title: '', body: bodyMarkdown };
  }

  const yamlContent = bodyMarkdown.slice(4, closingIndex); // "---\n" 之后到关闭 "---" 之前

  // 简单提取 title 行（不引入完整 YAML 解析，notes frontmatter 只有 title 字段）
  let title = '';
  for (const line of yamlContent.split('\n')) {
    const match = line.match(/^title:\s*(.*)$/);
    if (match) {
      title = match[1].trim();
      // 去掉可能存在的引号包裹
      if (
        (title.startsWith('"') && title.endsWith('"')) ||
        (title.startsWith("'") && title.endsWith("'"))
      ) {
        title = title.slice(1, -1);
      }
      break;
    }
  }

  // 关闭 "---\n" 之后的内容是正文
  const body = bodyMarkdown.slice(closingIndex + 4).trimStart();
  return { title, body };
}

export interface UploadAssetInput {
  originalFileName: string;
  contentType: string;
  buffer: Buffer;
}

@Injectable()
export class NoteViewService {
  constructor(
    private readonly contentService: ContentService,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
    private readonly editorDraftRepository: EditorDraftRepository,
    private readonly minioService: OssService,
    private readonly navigationRepository: NavigationRepository,
  ) {}

  /** 发布最新版本(供一键发布全部 publish-all 统一派发;实现 ScopePublisher)。 */
  async publishLatest(contentItemId: string): Promise<void> {
    await this.contentService.publishVersion(contentItemId);
  }

  private toDraftDto(draft: EditorDraft): EditorDraftDto {
    return {
      id: draft._id,
      contentItemId: draft.contentItemId,
      title: draft.title,
      summary: draft.summary ?? '',
      bodyMarkdown: draft.bodyMarkdown,
      changeNote: draft.changeNote,
      savedAt: draft.savedAt.toISOString(),
      savedBy: draft.savedBy,
    };
  }

  /**
   * 获取笔记详情，返回完整 ContentDetailDto（含 latestVersion/publishedVersion）。
   * 前端 NoteReader 组件依赖嵌套的版本结构来渲染标题、摘要和发布状态，
   * 因此 notes scope 不能使用 WorkspaceService 的扁平 DTO 格式。
   *
   * frontmatter 剥离：snapshot 存储的 bodyMarkdown 含 frontmatter，
   * 返回给前端前剥掉（PlateJS 编辑器不理解 frontmatter）。
   */
  async getById(id: string, visibility?: string): Promise<ContentDetailDto> {
    const vis =
      visibility === 'all' ? ContentVisibility.all : ContentVisibility.public;
    // 管理视图（visibility=all）返回原始相对路径，防止编辑器保存时 OSS URL 污染 snapshot
    const rawAssets = vis === ContentVisibility.all;
    const detail = await this.contentService.getContentById(
      id,
      { visibility: vis },
      { scope: 'notes', rawAssets },
    );
    // 剥掉 frontmatter，只把正文返回给前端
    const { body } = stripNoteFrontmatter(detail.bodyMarkdown);
    return { ...detail, bodyMarkdown: body };
  }

  /**
   * 获取笔记列表项 DTO（含 latestVersion/publishedVersion），
   * 比 getById 轻量——不读取 Git 源文件。
   */
  async getListItem(id: string): Promise<ContentListItemDto> {
    return this.contentService.getContentListItem(id);
  }

  /**
   * 正式保存内容（编辑器提交）。
   * commit 前先把 MinIO 草稿资源落盘到 git assets 目录，
   * 并将 markdown 中的草稿预览 URL 改写为 git 相对路径 ./assets/{name}。
   */
  async saveContent(
    id: string,
    dto: SaveContentDto,
  ): Promise<ContentDetailDto> {
    // 1. 草稿资源提升到 OSS 永久位置（内部拷贝，零流量）+ 下载到磁盘（Git 归档用）
    await this.minioService.promoteDraftAssets(id).catch(() => {});
    const assetsDir = join(
      this.contentRepoService.getContentDirectoryPath(id),
      'assets',
    );
    const materialized = await this.minioService.moveDraftAssetsToDisk(
      id,
      assetsDir,
    );

    // 2. 改写 markdown 中所有图片 URL 为 git 相对路径 ./assets/{fileName}
    //    覆盖三种来源：draft-assets 代理 URL、assets 代理 URL、OSS 签名直连 URL
    let { bodyMarkdown } = dto;
    if (bodyMarkdown) {
      const draftUrlPattern = new RegExp(
        `/api/v1/spaces/notes/items/${id}/draft-assets/([^)\\s"]+)`,
        'g',
      );
      const assetUrlPattern = new RegExp(
        `/api/v1/spaces/notes/items/${id}/assets/([^)\\s"]+)`,
        'g',
      );
      // OSS 签名 URL：匹配 assets/{contentId}/{fileName} 部分，忽略查询参数
      const ossUrlPattern = new RegExp(
        `https?://[^/]+/assets/${id}/([^?)\\s"]+)[^)\\s"]*`,
        'g',
      );
      bodyMarkdown = bodyMarkdown
        .replace(draftUrlPattern, (_match, fileName) => `./assets/${fileName}`)
        .replace(assetUrlPattern, (_match, fileName) => `./assets/${fileName}`)
        .replace(ossUrlPattern, (_match, fileName) => `./assets/${fileName}`);
    }

    // 3. 给正文加上 frontmatter（编辑器发来的是纯 markdown，Git 文件协议要求有 frontmatter）
    //    addNoteFrontmatter 是幂等的：已有 frontmatter 的内容不会重复包装
    bodyMarkdown = addNoteFrontmatter(dto.title, bodyMarkdown ?? '');
    dto = { ...dto, bodyMarkdown };

    // 4. 委托 ContentService 写入 Git
    const result = await this.contentService.saveContent(id, dto);

    // 5. commit 成功后清理 MinIO 草稿资源
    if (materialized.length > 0) {
      await this.minioService.deleteDraftAssets(id);
    }

    // 6. commit 时把文档标题镜像回 navigation node.name —— 让 admin 树/列表
    //    显示的节点名跟最新提交的内容标题保持一致。设计上：node.name 是
    //    "当前版本内容标题在导航树的投影"，文档节点的重命名入口已下线，
    //    唯一改名路径是编辑器→commit→这里同步。只在 commit（而非 draft）
    //    时同步，保证名字变更也是版本节点（参见 workspace.service.update
    //    通用路径的同样实现）。
    if (dto.action === ContentSaveAction.commit && dto.title) {
      const navNode = await this.navigationRepository.findByContentItemId(id);
      if (navNode) {
        await this.navigationRepository.update(navNode._id.toString(), {
          name: dto.title,
        });
      }
    }

    return result;
  }

  /** 获取草稿：先确认 contentItem 存在，再查 draft。无草稿返回 null（200），避免 404 污染浏览器 console。 */
  async getDraft(id: string): Promise<EditorDraftDto | null> {
    await this.contentService.assertContentItemExists(id);
    const draft = await this.editorDraftRepository.findByContentItemId(id);
    if (!draft) {
      return null;
    }
    return this.toDraftDto(draft);
  }

  /**
   * 读取 AI 初稿（只读端点）。
   *
   * 隔离说明：aidraft:{topicId} 前缀与普通草稿 draft:{id} 完全隔离，
   * 此方法只读不写，绝不触发 commit/publish 流水线。
   * 供学习模块左栏 Aurora 产出区展示 write_learn_plan 写入的规划提案。
   */
  async getAiDraft(id: string): Promise<EditorDraftDto | null> {
    await this.contentService.assertContentItemExists(id);
    const draft =
      await this.editorDraftRepository.findAiDraftByContentItemId(id);
    if (!draft) {
      return null;
    }
    return this.toDraftDto(draft);
  }

  /**
   * 批量判定哪些节点「有非空 AI 初稿」（学习页 studied 标记用）。
   * 一次请求 + 只投影 _id，替掉前端逐篇 getAiDraft 拉整篇的重复请求与流量浪费。
   * 不校验每个节点是否存在（缺失/无 aidraft 一律不在返回集里），轻量探针语义。
   */
  async getContentItemIdsWithAiDraft(ids: string[]): Promise<string[]> {
    return this.editorDraftRepository.findContentItemIdsWithAiDraft(ids);
  }

  /** 保存草稿（autosave）：只写 MongoDB，不触发 Git commit。 */
  async saveDraft(id: string, dto: SaveDraftDto): Promise<EditorDraftDto> {
    await this.contentService.assertContentEditable(id);
    const draft = await this.editorDraftRepository.save({
      contentItemId: id,
      title: dto.title,
      summary: dto.summary,
      bodyMarkdown: dto.bodyMarkdown,
      changeNote: dto.changeNote,
      savedAt: new Date(),
      savedBy: dto.savedBy,
    });
    return this.toDraftDto(draft);
  }

  /** 丢弃草稿：删除 MongoDB 草稿 + 清理 MinIO 中关联的草稿资源。 */
  async deleteDraft(id: string): Promise<void> {
    await this.contentService.assertContentItemExists(id);
    await Promise.all([
      this.editorDraftRepository.deleteByContentItemId(id),
      this.minioService.deleteDraftAssets(id),
    ]);
  }

  /**
   * 更新元数据（summary 等），走版本化流程（创建新快照）。
   * 返回更新后的完整详情 DTO，前端可直接刷新状态。
   */
  async patchMeta(
    id: string,
    fields: { summary?: string },
  ): Promise<ContentDetailDto> {
    await this.contentService.patchMeta(id, fields);
    return this.getById(id, 'all');
  }

  /** V2 版本历史：从 ContentSnapshot 读取，不依赖 Git log。 */
  async getHistory(id: string): Promise<ContentHistoryEntryDto[]> {
    return this.contentService.getContentHistory(id);
  }

  /**
   * V2: 获取指定版本的内容快照（versionId 或 commitHash 均可）。
   *
   * frontmatter 剥离：snapshot 存储的 bodyMarkdown 含 frontmatter，
   * 版本预览同样需要剥掉后再返回给前端。
   */
  async getByVersion(
    id: string,
    versionOrHash: string,
  ): Promise<ContentDetailDto> {
    const detail = await this.contentService.getContentByVersion(
      id,
      versionOrHash,
      { scope: 'notes' },
    );
    const { body } = stripNoteFrontmatter(detail.bodyMarkdown);
    return { ...detail, bodyMarkdown: body };
  }

  /** 上传附件到内容存储目录。 */
  async uploadAsset(
    id: string,
    input: UploadAssetInput,
  ): Promise<UploadedAssetDto> {
    await this.contentService.assertContentEditable(id);
    await this.contentService.prepareWritableContentWorkspace();

    const storedAsset = await this.contentRepoService.storeAsset(
      id,
      input.originalFileName,
      input.buffer,
    );

    return {
      // storedAsset.path 是 git 相对路径，uploadAsset 走 git 存储，不需要代理 URL
      url: storedAsset.path,
      fileName: storedAsset.fileName,
      contentType: input.contentType,
      size: input.buffer.byteLength,
    };
  }

  async listAssets(id: string): Promise<ListedAssetDto[]> {
    await this.contentService.assertContentItemExists(id);
    return this.contentRepoService.listAssets(id);
  }

  // ─── 草稿资源（MinIO 临时存储）───

  /** 文件名消毒：小写 + 去特殊字符 + 追加 uuid8 后缀防冲突。 */
  private sanitizeFileName(originalFileName: string): string {
    const parsed = parse(originalFileName);
    const baseName = (parsed.name || 'asset')
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const safeBaseName = baseName || 'asset';
    const extension = extname(parsed.base).toLowerCase();
    const suffix = randomUUID().slice(0, 8);
    return `${safeBaseName}-${suffix}${extension}`;
  }

  /** 上传草稿图片到 MinIO，返回预览 URL（编辑器中使用）。 */
  async uploadDraftAsset(
    id: string,
    input: UploadAssetInput,
  ): Promise<UploadedAssetDto> {
    await this.contentService.assertContentEditable(id);

    const fileName = this.sanitizeFileName(input.originalFileName);
    await this.minioService.uploadDraftAsset(
      id,
      fileName,
      input.buffer,
      input.contentType,
    );

    return {
      // 草稿资源走 MinIO 代理 URL，前端编辑器中直接可访问
      url: `/api/v1/spaces/notes/items/${id}/draft-assets/${fileName}`,
      fileName,
      contentType: input.contentType,
      size: input.buffer.byteLength,
    };
  }

  /** 代理返回 MinIO 中的草稿资源（用户端不直连 MinIO）。 */
  async getDraftAsset(
    id: string,
    fileName: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return this.minioService.getDraftAsset(id, fileName);
  }
}
