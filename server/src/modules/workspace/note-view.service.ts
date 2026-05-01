/**
 * NoteViewService — 笔记 scope 的特有逻辑。
 *
 * 处理笔记模块独有的功能：
 * - 草稿 CRUD（autosave，不产生 Git 版本）
 * - 版本历史查询（基于 Git commit 记录）
 * - 正式内容保存（编辑器提交，通过 ContentService 写入 Git）
 *
 * 从原 EditorModule（editor.service.ts）迁移而来。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { join, parse, extname } from 'path';
import { ContentService } from '../content/content.service';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentGitService } from '../content/content-git.service';
import { MinioService } from '../minio/minio.service';
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
    private readonly minioService: MinioService,
  ) {}

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
   * 获取笔记详情，返回完整 ContentDetailDto（含 latestVersion/publishedVersion）。
   * 前端 NoteReader 组件依赖嵌套的版本结构来渲染标题、摘要和发布状态，
   * 因此 notes scope 不能使用 WorkspaceService 的扁平 DTO 格式。
   */
  async getById(id: string, visibility?: string): Promise<ContentDetailDto> {
    const vis =
      visibility === 'all' ? ContentVisibility.all : ContentVisibility.public;
    return this.contentService.getContentById(id, { visibility: vis });
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
  async saveContent(id: string, dto: SaveContentDto): Promise<ContentDetailDto> {
    // 1. 将 MinIO 草稿资源下载到 content/{id}/assets/
    const assetsDir = join(
      this.contentRepoService.getContentDirectoryPath(id),
      'assets',
    );
    const materialized = await this.minioService.moveDraftAssetsToDisk(
      id,
      assetsDir,
    );

    // 2. 改写 markdown 中的草稿预览 URL 为 git 相对路径
    let { bodyMarkdown } = dto;
    if (materialized.length > 0 && bodyMarkdown) {
      const draftUrlPattern = new RegExp(
        `/api/v1/spaces/notes/items/${id}/draft-assets/([^)\\s"]+)`,
        'g',
      );
      bodyMarkdown = bodyMarkdown.replace(
        draftUrlPattern,
        (_match, fileName) => `./assets/${fileName}`,
      );
      dto = { ...dto, bodyMarkdown };
    }

    // 3. 委托 ContentService 写入 Git
    const result = await this.contentService.saveContent(id, dto);

    // 4. commit 成功后清理 MinIO 草稿资源
    if (materialized.length > 0) {
      await this.minioService.deleteDraftAssets(id);
    }

    return result;
  }

  /** 获取草稿：先确认 contentItem 存在，再查 draft，区分"内容不存在"和"无草稿"。 */
  async getDraft(id: string): Promise<EditorDraftDto> {
    await this.contentService.assertContentItemExists(id);
    const draft = await this.editorDraftRepository.findByContentItemId(id);
    if (!draft) {
      throw new NotFoundException(`Draft for content ${id} not found`);
    }
    return this.toDraftDto(draft);
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

  /** 版本历史：从 Git commit 记录中读取。 */
  async getHistory(id: string): Promise<ContentHistoryEntryDto[]> {
    await this.contentService.assertContentItemExists(id);
    return this.contentGitService.listContentHistory(id);
  }

  /** 获取指定 Git commit 版本的内容快照。 */
  async getByVersion(
    id: string,
    commitHash: string,
  ): Promise<ContentDetailDto> {
    return this.contentService.getContentByVersion(id, commitHash);
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
      path: storedAsset.path,
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
      path: `/api/v1/spaces/notes/items/${id}/draft-assets/${fileName}`,
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
