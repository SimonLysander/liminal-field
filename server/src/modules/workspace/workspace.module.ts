/**
 * WorkspaceModule — 统一的薄业务层模块。
 *
 * 架构定位：三层架构的顶层。
 * - 依赖 ContentModule（纯存储层，Git + MongoDB）
 * - 依赖 NavigationModule（业务索引层，scope 隔离）
 *
 * 内部结构：
 * - WorkspaceService：scope 驱动的通用 CRUD（所有业务模块共享）
 * - NoteViewService：笔记特有（草稿、版本历史）
 * - GalleryViewService：画廊特有（封面图、照片列表、直出）
 * - WorkspaceController：统一路由 /spaces/:scope/items/...
 *
 * 新增业务模块只需：追加 NavigationScope 枚举值 + 可选的 ViewService。
 */
import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { ContentModule } from '../content/content.module';
import { NavigationModule } from '../navigation/navigation.module';
import { EditorDraft } from './editor-draft.entity';
import { EditorDraftRepository } from './editor-draft.repository';
import { WorkspaceService } from './workspace.service';
import { NoteViewService } from './note-view.service';
import { GalleryViewService } from './gallery-view.service';
import { WorkspaceController } from './workspace.controller';

@Module({
  imports: [
    ContentModule,
    NavigationModule,
    TypegooseModule.forFeature([EditorDraft]),
  ],
  controllers: [WorkspaceController],
  providers: [
    WorkspaceService,
    NoteViewService,
    GalleryViewService,
    EditorDraftRepository,
  ],
  exports: [WorkspaceService, NoteViewService, GalleryViewService],
})
export class WorkspaceModule {}
