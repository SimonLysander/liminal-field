/**
 * WorkspaceController — 统一路由层。
 *
 * 路由设计:/spaces/:scope/items/... 所有 scope 共享同一套 REST 端点,
 * scope 特有的路由(如 notes 的草稿/版本、gallery 的照片直出)挂在对应的静态路径下。
 *
 * 路由优先级注意:NestJS 按注册顺序匹配路由。
 * 静态路径 'notes/items/:id/draft' 必须注册在通用 ':scope/items/:id' 之前,
 * 否则 'notes' 会被当成 scope 参数、'items' 后面的部分无法匹配到专用路由。
 * 这里把 notes 特有路由放在类的前面,通用路由放在后面。
 *
 * Phase 1 重构(2026-05-31):删除 11 个 anthology/items/:id/entries/* 端点,
 * 文集容器 + 子节点统一走通用 :scope/items/:id 接口(创建/读取/保存/发布/删除)。
 * 草稿走新增的通用 :scope/items/:id/draft 端点,内部按 scope 分流到对应 service。
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
  AnthologyEntryDetailDto,
  AnthologyPublicDetailDto,
} from './dto/anthology-view.dto';
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

  // ─── Notes 特有路由(必须在通用 :scope 路由之前注册)───

  /** 笔记正式保存(编辑器提交),走 ContentService 的完整版本化流程。 */
  @Put('notes/items/:id')
  async saveNoteContent(
    @Param('id') id: string,
    @Body() dto: SaveContentDto,
  ): Promise<ContentDetailDto> {
    return this.noteViewService.saveContent(id, dto);
  }

  /** 轻量更新笔记元数据(摘要等),不创建新版本。 */
  @Patch('notes/items/:id/meta')
  async patchNoteMeta(
    @Param('id') id: string,
    @Body() dto: PatchMetaDto,
  ): Promise<ContentDetailDto> {
    return this.noteViewService.patchMeta(id, dto);
  }

  /**
   * 读取笔记 AI 初稿（只读，绝不触发 commit/publish）。
   * 静态路由 notes/items/:id/aidraft 必须注册在通用 :scope/items/:id 动态路由之前，
   * 否则 'aidraft' 会被匹配为 scope 参数。
   * 数据来自 aidraft:{id} 前缀，与普通草稿 draft:{id} 完全隔离。
   */
  @Get('notes/items/:id/aidraft')
  async getNoteAiDraft(
    @Param('id') id: string,
  ): Promise<EditorDraftDto | null> {
    return this.noteViewService.getAiDraft(id);
  }

  @Get('notes/items/:id/draft')
  async getDraft(@Param('id') id: string): Promise<EditorDraftDto | null> {
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

  // ─── Notes 批量操作(静态路由,在通用 :scope 之前)───

  /** 递归发布文件夹下所有文档(纯指针操作,不写 Git)。 */
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

  // ─── Gallery 特有路由(必须在通用 :scope 路由之前注册)───

  /**
   * 画廊帖子正式提交:接收结构化 JSON,后端负责序列化为 frontmatter main.md。
   * 必须注册在通用 ':scope/items/:id' 之前,否则 'gallery' 会被匹配为 scope 参数。
   */
  @Put('gallery/items/:id')
  async updateGalleryPost(
    @Param('id') id: string,
    @Body() dto: SaveGalleryPostDto,
  ): Promise<GalleryAdminDetailDto> {
    return this.galleryViewService.commitPost(id, dto);
  }

  /** 获取画廊帖子的结构化草稿。无草稿时返回 null(200),避免 404 噪音。 */
  @Get('gallery/items/:id/draft')
  async getGalleryDraft(
    @Param('id') id: string,
  ): Promise<GalleryDraftDto | null> {
    return this.galleryViewService.getDraft(id);
  }

  /** 保存画廊帖子的草稿(前端发结构化 JSON,后端序列化为 frontmatter 存储)。 */
  @Put('gallery/items/:id/draft')
  async saveGalleryDraft(
    @Param('id') id: string,
    @Body() dto: SaveGalleryPostDto,
  ): Promise<GalleryDraftDto> {
    return this.galleryViewService.saveDraft(id, dto);
  }

  /** 删除画廊帖子的草稿(提交后清理)。 */
  @Delete('gallery/items/:id/draft')
  async deleteGalleryDraft(@Param('id') id: string): Promise<void> {
    return this.galleryViewService.deleteDraft(id);
  }

  /** 画廊帖子的版本历史(复用 NoteViewService)。 */
  @Get('gallery/items/:id/history')
  async getGalleryHistory(
    @Param('id') id: string,
  ): Promise<ContentHistoryEntryDto[]> {
    return this.noteViewService.getHistory(id);
  }

  /** 画廊帖子的历史版本内容(返回解析后的结构化数据,不暴露 frontmatter)。 */
  @Get('gallery/items/:id/versions/:versionId')
  async getGalleryByVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.galleryViewService.getByVersion(id, versionId);
  }

  /**
   * 编辑器加载接口:后端合并草稿和正式版照片列表,
   * 前端不再需要区分 MinIO vs Git URL。
   */
  @Get('gallery/items/:id/editor')
  async getGalleryEditorState(
    @Param('id') id: string,
  ): Promise<GalleryEditorDto> {
    return this.galleryViewService.getEditorState(id);
  }

  // ─── 草稿资源(MinIO 临时存储)───

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

  /** 代理返回画廊草稿照片(用户端不直连 MinIO)。 */
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

  /** 上传草稿图片到 MinIO,返回预览 URL。 */
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

  /** 代理返回草稿资源(用户端不直连 MinIO)。 */
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

  // ─── Anthology 阅读端 + 版本历史(必须在通用 :scope 路由之前注册)───
  //
  // Phase 1 重构(2026-05-31):删除全部 anthology/items/:id/entries/* 写端点,
  // 仅保留阅读端读取接口(供 /anthology 前台路由用)。容器/子节点的 CRUD/草稿
  // 走通用 :scope/items/:id 接口。

  /**
   * 文集阅读端:卷宗概览(含已发布子节点目录 + 卷首语)。
   * Phase 1 新增字段 bodyMarkdown(容器节点的卷首语)。
   */
  @Public()
  @Get('anthology/public/items/:id')
  async getAnthologyPublicDetail(
    @Param('id') id: string,
  ): Promise<AnthologyPublicDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.toPublicDetail(id);
  }

  /**
   * 文集阅读端:单篇条目阅读(含正文 + prev/next 导航)。
   * Phase 1 起 nodeId 直接用通用节点 id(子 contentItemId),内部走 getEntryDetail。
   * 未登录读已发布冻结版本,管理端读最新版本。
   */
  @Public()
  @Get('anthology/public/items/:id/entries/:nodeId')
  async getAnthologyPublicEntry(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Req() request: FastifyRequest,
  ): Promise<AnthologyEntryDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    const usePublished = !request.user;
    return this.anthologyViewService.getEntryDetail(id, nodeId, usePublished);
  }

  /**
   * 文集管理端:某子节点的历史版本快照内容。
   * 必须在通用 :scope/items/:id/versions/:versionId(如有) 之前注册——anthology 在路径
   * 上含 entries/:nodeId 段,跟通用 :scope 不冲突。
   */
  @Get('anthology/items/:id/entries/:nodeId/history')
  async getAnthologyEntryHistory(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
  ): Promise<ContentHistoryEntryDto[]> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.getEntryHistory(id, nodeId);
  }

  @Get('anthology/items/:id/entries/:nodeId/versions/:versionId')
  async getAnthologyEntryByVersion(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Param('versionId') versionId: string,
  ): Promise<AnthologyEntryDetailDto> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.getEntryByVersion(id, nodeId, versionId);
  }

  @Get('anthology/items/:id/history')
  async getAnthologyHistory(
    @Param('id') id: string,
  ): Promise<ContentHistoryEntryDto[]> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.getAnthologyHistory(id);
  }

  @Get('anthology/items/:id/versions/:versionId')
  async getAnthologyByVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ) {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.getAnthologyByVersion(id, versionId);
  }

  /**
   * 一键递归发布文集容器 + 所有子节点。
   * 顺序:先发容器(子节点发布需先发容器),再并发发子节点。
   */
  @Post('anthology/items/:id/publish-all')
  async publishAnthologyAndDescendants(
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.workspaceService.assertScopeMatch('anthology', id);
    await this.anthologyViewService.publishAnthologyAndDescendants(id);
    return { success: true };
  }

  /** 轻量更新文集元数据(简介等),用于管理端中区 inline-edit。 */
  @Patch('anthology/items/:id/meta')
  async patchAnthologyMeta(@Param('id') id: string, @Body() dto: PatchMetaDto) {
    await this.workspaceService.assertScopeMatch('anthology', id);
    return this.anthologyViewService.patchMeta(id, dto);
  }

  // ─── 通用草稿接口(Phase 1 新增 anthology 走这里) ────────────────────────

  /**
   * 通用节点草稿读取:文集容器/子节点用此接口。
   * 笔记侧已有专用 notes/items/:id/draft 路由(含 MinIO 草稿资源管理),
   * 静态路由先匹配——故笔记不会落到这条通用路由。
   * 画廊侧同理走专用 gallery/items/:id/draft。
   */
  @Get(':scope/items/:id/draft')
  async getScopedDraft(
    @Param('scope') scope: string,
    @Param('id') id: string,
  ): Promise<EditorDraftDto | null> {
    await this.workspaceService.assertScopeMatch(scope, id);
    if (scope === 'anthology') {
      return this.anthologyViewService.getNodeDraft(id);
    }
    // 兜底:其它非笔记/非画廊 scope 暂不支持
    throw new BadRequestException(`Draft not supported for scope: ${scope}`);
  }

  @Put(':scope/items/:id/draft')
  async saveScopedDraft(
    @Param('scope') scope: string,
    @Param('id') id: string,
    @Body() dto: SaveDraftDto,
  ): Promise<EditorDraftDto> {
    await this.workspaceService.assertScopeMatch(scope, id);
    if (scope === 'anthology') {
      return this.anthologyViewService.saveNodeDraft(id, dto);
    }
    throw new BadRequestException(`Draft not supported for scope: ${scope}`);
  }

  @Delete(':scope/items/:id/draft')
  async deleteScopedDraft(
    @Param('scope') scope: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.workspaceService.assertScopeMatch(scope, id);
    if (scope === 'anthology') {
      return this.anthologyViewService.deleteNodeDraft(id);
    }
    throw new BadRequestException(`Draft not supported for scope: ${scope}`);
  }

  // ─── 通用 CRUD(所有 scope 共享)───

  /**
   * 列表路由:各 scope 返回不同的 DTO 格式。
   * - notes: ContentListItemDto(含 latestVersion/publishedVersion),前端依赖嵌套版本结构
   * - gallery: GalleryPostDto(含封面图/照片计数),由 GalleryViewService 组装
   * - 其他 scope: 通用 WorkspaceItemDto(扁平格式)
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
      // 管理端返回含封面/状态的 AdminListItemDto,展示端返回精简的 PublicListItemDto
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
      // 管理端返回含状态的 AdminListItemDto,展示端返回精简的 PublicListItemDto
      return Promise.all(
        items.map((n) =>
          isAdmin
            ? this.anthologyViewService.toAdminListItem(n.id)
            : this.anthologyViewService.toPublicListItem(n.id),
        ),
      );
    }
    if (scope === 'notes') {
      // notes scope 需返回 ContentListItemDto 格式,前端依赖 latestVersion 等嵌套字段
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
   * 详情路由:各 scope 返回不同的 DTO 格式。
   * - notes: ContentDetailDto(含 latestVersion/publishedVersion + bodyMarkdown),
   *   前端 NoteReader 依赖嵌套版本结构渲染标题和发布状态
   * - gallery: GalleryPostDetailDto(含照片列表)
   * - anthology: Phase 1 起管理端返回 toAdminDetail(含 bodyMarkdown 卷首语 + 容器状态),
   *   展示端走专用 anthology/public/items/:id 接口
   * - 其他 scope: 通用 WorkspaceItemDetailDto(扁平格式)
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
    // scope 校验:确保 content item 属于请求的 scope
    await this.workspaceService.assertScopeMatch(scope, id);
    if (scope === 'gallery') {
      // 管理端(visibility=all)返回含 publishedCommitHash 等管理字段的详情
      if (visibility === ContentVisibility.all) {
        return this.galleryViewService.toAdminDetailDto(id);
      }
      return this.galleryViewService.toPublicDetailDto(id);
    }
    if (scope === 'anthology') {
      // 管理端(visibility=all)返回容器视图 + 状态;展示端走专用 /public/ 路由
      if (visibility === ContentVisibility.all) {
        return this.anthologyViewService.toAdminDetail(id);
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
    // anthology 文集级发布走独立方法,不再用通用 publish
    if (scope === 'anthology') {
      await this.anthologyViewService.publishAnthology(id, body?.versionId);
      if (await this.anthologyViewService.isAnthologyContainer(id)) {
        return this.anthologyViewService.toAdminDetail(id);
      }
      return { success: true };
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
      if (await this.anthologyViewService.isAnthologyContainer(id)) {
        return this.anthologyViewService.toAdminDetail(id);
      }
      return { success: true };
    }
    await this.workspaceService.unpublish(scope, id);
    if (scope === 'notes') return this.noteViewService.getById(id, 'all');
    if (scope === 'gallery')
      return this.galleryViewService.toAdminDetailDto(id);
    return this.workspaceService.getById(scope, id);
  }

  // ─── 附件(上传、列表、文件直出)───

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

  /** 文件直出(gallery 照片、notes 附件均通过此路由)。?v=commitHash 支持历史版本资源。 */
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
    // V2: ?v= 现在是 versionId(nanoid),不再是 commitHash,不做 hex 校验。
    // 资源从磁盘读取当前文件(Phase 1 OSS 后改为 redirect 到 OSS URL)。
    const { buffer, contentType } =
      await this.galleryViewService.readPhotoBuffer(id, fileName);
    reply.header('Content-Type', contentType);
    // 带版本号的资源可以长缓存(内容不可变),否则用短缓存
    reply.header(
      'Cache-Control',
      version ? 'public, max-age=31536000, immutable' : 'public, max-age=86400',
    );
    reply.send(buffer);
  }
}
