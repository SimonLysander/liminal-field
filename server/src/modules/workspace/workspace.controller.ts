/**
 * WorkspaceController — 统一路由层。
 *
 * 路由设计：/spaces/:scope/items/... 所有 scope 共享同一套 REST 端点，
 * scope 特有的路由（如 notes 的草稿/版本、gallery 的照片直出）挂在对应的静态路径下。
 *
 * 路由优先级注意：NestJS 按注册顺序匹配路由。
 * 静态路径 'notes/items/:id/draft' 必须注册在通用 ':scope/items/:id' 之前，
 * 否则 'notes' 会被当成 scope 参数、'items' 后面的部分无法匹配到专用路由。
 * 这里把 notes 特有路由放在类的前面，通用路由放在后面。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { ContentVisibility } from '../content/dto/content-query.dto';
import { RawResponse } from '../../common/raw-response.decorator';
import type { MultipartFile } from '@fastify/multipart';
import { ContentDetailDto } from '../content/dto/content-detail.dto';
import { ContentHistoryEntryDto } from '../content/dto/content-history.dto';
import { SaveContentDto } from '../content/dto/save-content.dto';
import { WorkspaceService } from './workspace.service';
import { NoteViewService } from './note-view.service';
import { GalleryViewService } from './gallery-view.service';
import { AnthologyViewService } from './anthology-view.service';
import { CreateWorkspaceItemDto } from './dto/create-workspace-item.dto';
import { UpdateWorkspaceItemDto } from './dto/update-workspace-item.dto';
import { EditorDraftDto } from './dto/editor-draft.dto';
import { PatchMetaDto } from './dto/patch-meta.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import {
  GalleryAdminDetailDto,
  GalleryEditorDto,
  GalleryDraftDto,
} from './dto/gallery-view.dto';
import { SaveGalleryPostDto } from './dto/save-gallery-post.dto';
import {
  AnthologyAdminDetailDto,
  AnthologyAdminListItemDto,
  AnthologyEntryDetailDto,
  AnthologyPublicDetailDto,
  AnthologyPublicListItemDto,
} from './dto/anthology-view.dto';
import { SaveAnthologyEntryDto, ReorderAnthologyEntriesDto } from './dto/save-anthology.dto';
import { BatchOperationDto } from './dto/batch-operation.dto';

type MultipartRequest = {
  file: () => Promise<MultipartFile | undefined>;
};

@Controller('spaces')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly noteViewService: NoteViewService,
    private readonly galleryViewService: GalleryViewService,
    private readonly anthologyViewService: AnthologyViewService,
  ) {}

  // ─── Notes 特有路由（必须在通用 :scope 路由之前注册）───

  /** 笔记正式保存（编辑器提交），走 ContentService 的完整版本化流程。 */
  @Put('notes/items/:id')
  async saveNoteContent(
    @Param('id') id: string,
    @Body() dto: SaveContentDto,
  ): Promise<ContentDetailDto> {
    return this.noteViewService.saveContent(id, dto);
  }

  /** 轻量更新笔记元数据（摘要等），不创建新版本。 */
  @Patch('notes/items/:id/meta')
  async patchNoteMeta(
    @Param('id') id: string,
    @Body() dto: PatchMetaDto,
  ): Promise<ContentDetailDto> {
    return this.noteViewService.patchMeta(id, dto);
  }

  @Get('notes/items/:id/draft')
  async getDraft(@Param('id') id: string): Promise<EditorDraftDto> {
    return this.noteViewService.getDraft(id);
  }

  @Put('notes/items/:id/draft')
  async saveDraft(
    @Param('id') id: string,
    @Body() dto: SaveDraftDto,
  ): Promise<EditorDraftDto> {
    return this.noteViewService.saveDraft(id, dto);
  }

  @Delete('notes/items/:id/draft')
  async deleteDraft(@Param('id') id: string): Promise<void> {
    return this.noteViewService.deleteDraft(id);
  }

  @Get('notes/items/:id/history')
  async getHistory(@Param('id') id: string): Promise<ContentHistoryEntryDto[]> {
    return this.noteViewService.getHistory(id);
  }

  @Get('notes/items/:id/versions/:versionId')
  async getByVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ): Promise<ContentDetailDto> {
    return this.noteViewService.getByVersion(id, versionId);
  }

  // ─── Notes 批量操作（静态路由，在通用 :scope 之前）───

  /** 递归发布文件夹下所有文档（纯指针操作，不写 Git）。 */
  @Post('notes/batch/publish')
  async batchPublish(
    @Body() body: BatchOperationDto,
  ): Promise<{ successCount: number; skippedCount: number }> {
    return this.workspaceService.batchPublish(body.folderId);
  }

  /** 递归取消发布文件夹下所有文档。 */
  @Post('notes/batch/unpublish')
  async batchUnpublish(
    @Body() body: BatchOperationDto,
  ): Promise<{ successCount: number; skippedCount: number }> {
    return this.workspaceService.batchUnpublish(body.folderId);
  }

  // ─── Gallery 特有路由（必须在通用 :scope 路由之前注册）───

  /**
   * 画廊帖子正式提交：接收结构化 JSON，后端负责序列化为 frontmatter main.md。
   * 必须注册在通用 ':scope/items/:id' 之前，否则 'gallery' 会被匹配为 scope 参数。
   */
  @Put('gallery/items/:id')
  async updateGalleryPost(
    @Param('id') id: string,
    @Body() dto: SaveGalleryPostDto,
  ): Promise<GalleryAdminDetailDto> {
    return this.galleryViewService.commitPost(id, dto);
  }

  /** 获取画廊帖子的结构化草稿。无草稿时返回 null（200），避免 404 噪音。 */
  @Get('gallery/items/:id/draft')
  async getGalleryDraft(
    @Param('id') id: string,
  ): Promise<GalleryDraftDto | null> {
    return this.galleryViewService.getDraft(id);
  }

  /** 保存画廊帖子的草稿（前端发结构化 JSON，后端序列化为 frontmatter 存储）。 */
  @Put('gallery/items/:id/draft')
  async saveGalleryDraft(
    @Param('id') id: string,
    @Body() dto: SaveGalleryPostDto,
  ): Promise<GalleryDraftDto> {
    return this.galleryViewService.saveDraft(id, dto);
  }

  /** 删除画廊帖子的草稿（提交后清理）。 */
  @Delete('gallery/items/:id/draft')
  async deleteGalleryDraft(@Param('id') id: string): Promise<void> {
    return this.galleryViewService.deleteDraft(id);
  }

  /** 画廊帖子的版本历史（复用 NoteViewService）。 */
  @Get('gallery/items/:id/history')
  async getGalleryHistory(
    @Param('id') id: string,
  ): Promise<ContentHistoryEntryDto[]> {
    return this.noteViewService.getHistory(id);
  }

  /** 画廊帖子的历史版本内容（返回解析后的结构化数据，不暴露 frontmatter）。 */
  @Get('gallery/items/:id/versions/:versionId')
  async getGalleryByVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.galleryViewService.getByVersion(id, versionId);
  }

  /**
   * 编辑器加载接口：后端合并草稿和正式版照片列表，
   * 前端不再需要区分 MinIO vs Git URL。
   */
  @Get('gallery/items/:id/editor')
  async getGalleryEditorState(
    @Param('id') id: string,
  ): Promise<GalleryEditorDto> {
    return this.galleryViewService.getEditorState(id);
  }

  // ─── 草稿资源（MinIO 临时存储）───

  /** 上传画廊草稿照片到 MinIO。 */
  @Post('gallery/items/:id/draft-assets')
  async uploadGalleryDraftPhoto(
    @Param('id') id: string,
    @Req() request: MultipartRequest,
  ) {
    const file = await request.file();
    if (!file) throw new BadRequestException('File is required');
    const buffer = await file.toBuffer();
    return this.galleryViewService.uploadDraftPhoto(id, {
      originalFileName: file.filename,
      contentType: file.mimetype,
      buffer,
    });
  }

  /** 代理返回画廊草稿照片（用户端不直连 MinIO）。 */
  @RawResponse()
  @Get('gallery/items/:id/draft-assets/:fileName')
  async serveGalleryDraftPhoto(
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, contentType } = await this.galleryViewService.getDraftPhoto(
      id,
      fileName,
    );
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'no-cache');
    reply.send(buffer);
  }

  /** 上传草稿图片到 MinIO，返回预览 URL。 */
  @Post('notes/items/:id/draft-assets')
  async uploadDraftAsset(
    @Param('id') id: string,
    @Req() request: MultipartRequest,
  ) {
    const file = await request.file();
    if (!file) throw new BadRequestException('File is required');
    const buffer = await file.toBuffer();
    return this.noteViewService.uploadDraftAsset(id, {
      originalFileName: file.filename,
      contentType: file.mimetype,
      buffer,
    });
  }

  /** 代理返回草稿资源（用户端不直连 MinIO）。 */
  @RawResponse()
  @Get('notes/items/:id/draft-assets/:fileName')
  async serveDraftAsset(
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @Res() reply: FastifyReply,
  ) {
    const { buffer, contentType } = await this.noteViewService.getDraftAsset(
      id,
      fileName,
    );
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'no-cache');
    reply.send(buffer);
  }

  // ─── Anthology 特有路由（必须在通用 :scope 路由之前注册）───
  //
  // 路由优先级说明（双重约束）：
  // 1. 所有 "anthology/..." 静态路径必须在通用 ":scope/items/:id" 之前注册。
  // 2. PUT "entries/reorder" 必须在 PUT "entries/:entryKey" 之前注册，
  //    否则 "reorder" 会被当成 entryKey 参数命中错误 handler。
  //    NestJS 按注册顺序匹配，此处 reorder 在 :entryKey 之前，安全。

  /**
   * 重排条目顺序。
   * Body: { newOrder: string[] }，必须包含且仅包含现有所有 key。
   * 返回更新后的管理端详情 DTO。
   *
   * 必须在 PUT entries/:entryKey 之前注册，避免 "reorder" 被匹配为 entryKey。
   */
  @Put('anthology/items/:id/entries/reorder')
  async reorderAnthologyEntries(
    @Param('id') id: string,
    @Body() dto: ReorderAnthologyEntriesDto,
  ): Promise<AnthologyAdminDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.reorderEntries(id, dto.newOrder);
  }

  /**
   * 条目版本历史（按 fileName=entries/eXXX.md 筛选 snapshot 列表）。
   * 必须在 GET entries/:entryKey 之前注册，避免 "history" 被当成 entryKey 匹配。
   * 与 notes/gallery 的 /history 路由对称，供管理端版本时间线组件使用。
   */
  @Get('anthology/items/:id/entries/:entryKey/history')
  async getAnthologyEntryHistory(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
  ): Promise<ContentHistoryEntryDto[]> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.getEntryHistory(id, entryKey);
  }

  /**
   * 获取条目历史版本内容（按 versionId 精确定位 snapshot）。
   * 用于管理端版本时间线点击后，在中栏展示历史版本正文。
   *
   * 路由优先级：必须在 GET entries/:entryKey 之前注册，
   * 否则 "versions" 会被匹配为 entryKey 参数。
   * 同时必须在 GET entries/:entryKey/draft 之前或之后均可（两者不冲突，不同次级路径）。
   */
  @Get('anthology/items/:id/entries/:entryKey/versions/:versionId')
  async getAnthologyEntryByVersion(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
    @Param('versionId') versionId: string,
  ): Promise<AnthologyEntryDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.getEntryByVersion(id, entryKey, versionId);
  }

  /**
   * 获取条目草稿。无草稿返回 null（200），避免 404 噪音。
   * 必须在 GET entries/:entryKey 之前注册，否则 "draft" 会被匹配为 entryKey 参数。
   */
  @Get('anthology/items/:id/entries/:entryKey/draft')
  async getAnthologyEntryDraft(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
  ): Promise<EditorDraftDto | null> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.getEntryDraft(id, entryKey);
  }

  /** 保存条目草稿（autosave）。只写 MongoDB，不产生 Git snapshot。 */
  @Put('anthology/items/:id/entries/:entryKey/draft')
  async saveAnthologyEntryDraft(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
    @Body() dto: SaveDraftDto,
  ): Promise<EditorDraftDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.saveEntryDraft(id, entryKey, dto);
  }

  /** 丢弃条目草稿。 */
  @Delete('anthology/items/:id/entries/:entryKey/draft')
  async deleteAnthologyEntryDraft(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
  ): Promise<void> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.deleteEntryDraft(id, entryKey);
  }

  /**
   * 获取单篇条目详情。
   * 未登录（展示端）读已发布版本的索引 + 条目最新 snapshot，
   * 已登录（管理端）读最新版本。
   */
  @Public()
  @Get('anthology/items/:id/entries/:entryKey')
  async getAnthologyEntry(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
    @Req() request: FastifyRequest,
  ): Promise<AnthologyEntryDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    // 未登录用户（展示端）读已发布版本，管理端读最新版本
    const usePublished = !request.user;
    return this.anthologyViewService.getEntryDetail(id, entryKey, usePublished);
  }

  /**
   * 添加条目。
   * 返回更新后的管理端详情 DTO（含完整条目列表）。
   */
  @Post('anthology/items/:id/entries')
  async addAnthologyEntry(
    @Param('id') id: string,
    @Body() dto: SaveAnthologyEntryDto,
  ): Promise<AnthologyAdminDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.addEntry(id, dto);
  }

  /**
   * 编辑条目。
   * 返回更新后的管理端详情 DTO。
   */
  @Put('anthology/items/:id/entries/:entryKey')
  async saveAnthologyEntry(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
    @Body() dto: SaveAnthologyEntryDto,
  ): Promise<AnthologyAdminDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.saveEntry(id, entryKey, dto);
  }

  /**
   * 删除条目（仅从索引移除，snapshot 历史保留）。
   * 返回更新后的管理端详情 DTO。
   */
  @Delete('anthology/items/:id/entries/:entryKey')
  async removeAnthologyEntry(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.removeEntry(id, entryKey);
  }

  // ─── 通用 CRUD（所有 scope 共享）───

  /**
   * 列表路由：各 scope 返回不同的 DTO 格式。
   * - notes: ContentListItemDto（含 latestVersion/publishedVersion），前端依赖嵌套版本结构
   * - gallery: GalleryPostDto（含封面图/照片计数），由 GalleryViewService 组装
   * - 其他 scope: 通用 WorkspaceItemDto（扁平格式）
   */
  @Public()
  @Get(':scope/items')
  async list(
    @Param('scope') scope: string,
    @Query('status') status: 'draft' | 'published' | undefined,
    @Req() request: FastifyRequest,
  ) {
    // 未登录用户强制只返回已发布内容
    if (!request.user) {
      status = 'published';
    }
    if (scope === 'gallery') {
      const items = await this.workspaceService.list(scope, status);
      const isAdmin = !!request.user;
      // 管理端返回含封面/状态的 AdminListItemDto，展示端返回精简的 PublicListItemDto
      return Promise.all(
        items.map((n) =>
          isAdmin
            ? this.galleryViewService.toAdminListItemDto(n.id)
            : this.galleryViewService.toPublicListItemDto(n.id),
        ),
      );
    }
    if (scope === 'anthology') {
      const items = await this.workspaceService.list(scope, status);
      const isAdmin = !!request.user;
      // 管理端返回含状态的 AdminListItemDto，展示端返回精简的 PublicListItemDto
      return Promise.all(
        items.map((n) =>
          isAdmin
            ? this.anthologyViewService.toAdminListItem(n.id)
            : this.anthologyViewService.toPublicListItem(n.id),
        ),
      );
    }
    if (scope === 'notes') {
      // notes scope 需返回 ContentListItemDto 格式，前端依赖 latestVersion 等嵌套字段
      const items = await this.workspaceService.list(scope, status);
      return Promise.all(
        items.map((n) => this.noteViewService.getListItem(n.id)),
      );
    }
    return this.workspaceService.list(scope, status);
  }

  @Post(':scope/items')
  async create(
    @Param('scope') scope: string,
    @Body() dto: CreateWorkspaceItemDto,
  ) {
    return this.workspaceService.create(scope, dto);
  }

  /**
   * 详情路由：各 scope 返回不同的 DTO 格式。
   * - notes: ContentDetailDto（含 latestVersion/publishedVersion + bodyMarkdown），
   *   前端 NoteReader 依赖嵌套版本结构渲染标题和发布状态
   * - gallery: GalleryPostDetailDto（含照片列表）
   * - 其他 scope: 通用 WorkspaceItemDetailDto（扁平格式）
   */
  @Public()
  @Get(':scope/items/:id')
  async getById(
    @Param('scope') scope: string,
    @Param('id') id: string,
    @Query('visibility') visibility: string | undefined,
    @Req() request: FastifyRequest,
  ) {
    // 未登录用户强制只访问已发布内容
    if (!request.user) {
      visibility = ContentVisibility.public;
    }
    // scope 校验：确保 content item 属于请求的 scope
    await this.workspaceService.assertScopeMatch(scope, id);
    if (scope === 'gallery') {
      // 管理端（visibility=all）返回含 publishedCommitHash 等管理字段的详情
      if (visibility === ContentVisibility.all) {
        return this.galleryViewService.toAdminDetailDto(id);
      }
      return this.galleryViewService.toPublicDetailDto(id);
    }
    if (scope === 'anthology') {
      // 管理端（visibility=all）返回含状态信息的管理详情，展示端返回已发布版本
      if (visibility === ContentVisibility.all) {
        return this.anthologyViewService.toAdminDetail(id) as Promise<AnthologyPublicDetailDto | AnthologyAdminDetailDto>;
      }
      return this.anthologyViewService.toPublicDetail(id);
    }
    if (scope === 'notes') {
      return this.noteViewService.getById(id, visibility);
    }
    return this.workspaceService.getById(scope, id);
  }

  @Put(':scope/items/:id')
  async update(
    @Param('scope') scope: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceItemDto,
  ) {
    await this.workspaceService.assertScopeMatch(scope, id);
    return this.workspaceService.update(scope, id, dto);
  }

  @Delete(':scope/items/:id')
  async remove(@Param('scope') scope: string, @Param('id') id: string) {
    await this.workspaceService.assertScopeMatch(scope, id);
    return this.workspaceService.remove(scope, id);
  }

  // ─── Anthology 条目级发布路由（必须在通用 :scope/items/:id/publish 之前注册）───
  //
  // 路由优先级说明：这三个静态路径含 "anthology" 字面量，
  // 必须在通用 ":scope/items/:id/publish" 之前注册，否则会匹配到通用路由。

  /**
   * 发布单篇条目：把该条目的发布状态写入 ContentItem.entryPublishStates(Mongo,不进 Git)。
   * 文集已上线时同步刷新冻结结构。
   */
  @Put('anthology/items/:id/entries/:entryKey/publish')
  async publishAnthologyEntry(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.publishEntry(id, entryKey);
  }

  /**
   * 取消发布单篇条目：从 ContentItem.entryPublishStates 移除该条目(Mongo,不进 Git)。
   */
  @Put('anthology/items/:id/entries/:entryKey/unpublish')
  async unpublishAnthologyEntry(
    @Param('id') id: string,
    @Param('entryKey') entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.unpublishEntry(id, entryKey);
  }

  /**
   * 批量发布所有条目：把所有有内容的条目写入 entryPublishStates(各指向其最新 snapshot,Mongo)。
   * 文集已上线时同步刷新冻结结构。
   */
  @Post('anthology/items/:id/entries/publish-all')
  async publishAllAnthologyEntries(
    @Param('id') id: string,
  ): Promise<AnthologyAdminDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.publishAllEntries(id);
  }

  // ─── 发布/取消 ───

  @Put(':scope/items/:id/publish')
  async publish(
    @Param('scope') scope: string,
    @Param('id') id: string,
    @Body() body?: { versionId?: string },
  ) {
    await this.workspaceService.assertScopeMatch(scope, id);
    if (scope === 'gallery')
      await this.galleryViewService.assertPublishable(id, body?.versionId);
    // anthology 文集级发布走独立方法（含已发布条目校验），不再用通用 publish
    if (scope === 'anthology') {
      await this.anthologyViewService.publishAnthology(id);
      return this.anthologyViewService.toAdminDetail(id);
    }
    await this.workspaceService.publish(scope, id, body?.versionId);
    if (scope === 'notes') return this.noteViewService.getById(id, 'all');
    if (scope === 'gallery')
      return this.galleryViewService.toAdminDetailDto(id);
    return this.workspaceService.getById(scope, id);
  }

  @Put(':scope/items/:id/unpublish')
  async unpublish(@Param('scope') scope: string, @Param('id') id: string) {
    await this.workspaceService.assertScopeMatch(scope, id);
    // anthology 文集级取消发布走独立方法
    if (scope === 'anthology') {
      await this.anthologyViewService.unpublishAnthology(id);
      return this.anthologyViewService.toAdminDetail(id);
    }
    await this.workspaceService.unpublish(scope, id);
    if (scope === 'notes') return this.noteViewService.getById(id, 'all');
    if (scope === 'gallery')
      return this.galleryViewService.toAdminDetailDto(id);
    return this.workspaceService.getById(scope, id);
  }

  // ─── 附件（上传、列表、文件直出）───

  @Post(':scope/items/:id/assets')
  async uploadAsset(
    @Param('scope') scope: string,
    @Param('id') id: string,
    @Req() request: MultipartRequest,
  ) {
    await this.workspaceService.assertScopeMatch(scope, id);
    const file = await request.file();
    if (!file) throw new BadRequestException('File is required');
    const buffer = await file.toBuffer();
    return this.workspaceService.uploadAsset(scope, id, file.filename, buffer);
  }

  @Public()
  @Get(':scope/items/:id/assets')
  async listAssets(@Param('scope') scope: string, @Param('id') id: string) {
    await this.workspaceService.assertScopeMatch(scope, id);
    return this.workspaceService.listAssets(scope, id);
  }

  /** 文件直出（gallery 照片、notes 附件均通过此路由）。?v=commitHash 支持历史版本资源。 */
  @Public()
  @RawResponse()
  @Get(':scope/items/:id/assets/:fileName')
  async serveAsset(
    @Param('scope') _scope: string,
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @Query('v') version: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    // V2: ?v= 现在是 versionId（nanoid），不再是 commitHash，不做 hex 校验。
    // 资源从磁盘读取当前文件（Phase 1 OSS 后改为 redirect 到 OSS URL）。
    const { buffer, contentType } =
      await this.galleryViewService.readPhotoBuffer(id, fileName);
    reply.header('Content-Type', contentType);
    // 带版本号的资源可以长缓存（内容不可变），否则用短缓存
    reply.header(
      'Cache-Control',
      version ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
    );
    reply.send(buffer);
  }
}
