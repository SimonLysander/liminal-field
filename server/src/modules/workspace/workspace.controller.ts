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
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
import { CreateWorkspaceItemDto } from './dto/create-workspace-item.dto';
import { UpdateWorkspaceItemDto } from './dto/update-workspace-item.dto';
import { EditorDraftDto } from './dto/editor-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { UpdateGalleryMetaDto } from './dto/update-gallery-meta.dto';
import { GalleryPostDetailDto } from './dto/gallery-view.dto';

type MultipartRequest = {
  file: () => Promise<MultipartFile | undefined>;
};

@Controller('spaces')
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly noteViewService: NoteViewService,
    private readonly galleryViewService: GalleryViewService,
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

  @Get('notes/items/:id/versions/:commitHash')
  async getByVersion(
    @Param('id') id: string,
    @Param('commitHash') commitHash: string,
  ): Promise<ContentDetailDto> {
    return this.noteViewService.getByVersion(id, commitHash);
  }

  // ─── Gallery 特有路由（必须在通用 :scope 路由之前注册）───

  /** 获取画廊帖子的元数据（照片顺序、描述、封面、标签）。 */
  @Get('gallery/items/:id/meta')
  async getGalleryMeta(@Param('id') id: string): Promise<GalleryPostDetailDto> {
    return this.galleryViewService.toPostDetailDto(id);
  }

  /** 更新画廊帖子的 MongoDB 侧元数据，返回更新后的 detail。 */
  @Put('gallery/items/:id/meta')
  async updateGalleryMeta(
    @Param('id') id: string,
    @Body() dto: UpdateGalleryMetaDto,
  ): Promise<GalleryPostDetailDto> {
    return this.galleryViewService.updateMeta(id, dto);
  }

  /** 获取画廊帖子的编辑器草稿（复用 NoteViewService，草稿以 contentItemId 为键）。 */
  @Get('gallery/items/:id/draft')
  async getGalleryDraft(@Param('id') id: string): Promise<EditorDraftDto> {
    return this.noteViewService.getDraft(id);
  }

  /** 保存画廊帖子的编辑器草稿。 */
  @Put('gallery/items/:id/draft')
  async saveGalleryDraft(
    @Param('id') id: string,
    @Body() dto: SaveDraftDto,
  ): Promise<EditorDraftDto> {
    return this.noteViewService.saveDraft(id, dto);
  }

  /** 删除画廊帖子的编辑器草稿。 */
  @Delete('gallery/items/:id/draft')
  async deleteGalleryDraft(@Param('id') id: string): Promise<void> {
    return this.noteViewService.deleteDraft(id);
  }

  /** 画廊帖子的版本历史（复用 NoteViewService）。 */
  @Get('gallery/items/:id/history')
  async getGalleryHistory(@Param('id') id: string): Promise<ContentHistoryEntryDto[]> {
    return this.noteViewService.getHistory(id);
  }

  // ─── 草稿资源（MinIO 临时存储）───

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
    @Res() reply: any,
  ) {
    const { buffer, contentType } =
      await this.noteViewService.getDraftAsset(id, fileName);
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'no-cache');
    reply.send(buffer);
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
    if (!(request as any).user) {
      status = 'published';
    }
    if (scope === 'gallery') {
      const items = await this.workspaceService.list(scope, status);
      return Promise.all(
        items.map((n) => this.galleryViewService.toPostDto(n.id)),
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
    if (!(request as any).user) {
      visibility = ContentVisibility.public;
    }
    if (scope === 'gallery') {
      return this.galleryViewService.toPostDetailDto(id);
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
    return this.workspaceService.update(scope, id, dto);
  }

  @Delete(':scope/items/:id')
  async remove(
    @Param('scope') scope: string,
    @Param('id') id: string,
  ) {
    return this.workspaceService.remove(scope, id);
  }

  // ─── 发布/取消 ───

  @Put(':scope/items/:id/publish')
  async publish(@Param('scope') scope: string, @Param('id') id: string) {
    await this.workspaceService.publish(scope, id);
    // notes scope 前端依赖含 latestVersion/publishedVersion 的完整格式
    if (scope === 'notes') return this.noteViewService.getById(id, 'all');
    return this.workspaceService.getById(scope, id);
  }

  @Put(':scope/items/:id/unpublish')
  async unpublish(@Param('scope') scope: string, @Param('id') id: string) {
    await this.workspaceService.unpublish(scope, id);
    if (scope === 'notes') return this.noteViewService.getById(id, 'all');
    return this.workspaceService.getById(scope, id);
  }

  // ─── 附件（上传、列表、文件直出）───

  @Post(':scope/items/:id/assets')
  async uploadAsset(
    @Param('scope') scope: string,
    @Param('id') id: string,
    @Req() request: MultipartRequest,
  ) {
    const file = await request.file();
    if (!file) throw new BadRequestException('File is required');
    const buffer = await file.toBuffer();
    return this.workspaceService.uploadAsset(scope, id, file.filename, buffer);
  }

  @Public()
  @Get(':scope/items/:id/assets')
  async listAssets(@Param('scope') scope: string, @Param('id') id: string) {
    return this.workspaceService.listAssets(scope, id);
  }

  /** 文件直出（gallery 照片、notes 附件均通过此路由）。 */
  @Public()
  @RawResponse()
  @Get(':scope/items/:id/assets/:fileName')
  async serveAsset(
    @Param('scope') _scope: string,
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @Res() reply: any,
  ) {
    const { buffer, contentType } =
      await this.galleryViewService.readPhotoBuffer(id, fileName);
    reply.header('Content-Type', contentType);
    reply.header('Cache-Control', 'public, max-age=86400');
    reply.send(buffer);
  }
}
