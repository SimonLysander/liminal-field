/**
 * HomeController — 首页聚合端点。
 *
 * 独立模块避免 ContentModule ↔ WorkspaceModule 循环依赖：
 * HomeModule 同时导入两者，聚合跨 scope 数据。
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ContentService } from '../content/content.service';
import { GalleryViewService } from '../workspace/gallery-view.service';

@Controller()
export class HomeController {
  constructor(
    private readonly contentService: ContentService,
    private readonly galleryViewService: GalleryViewService,
  ) {}

  /** 首页数据：统计 + 最近笔记 + 近期图集。 */
  @Public()
  @Get('home')
  async getHome() {
    const [latest, recentGallery, noteCount] = await Promise.all([
      this.contentService.getPublishedLatest(6),
      this.galleryViewService.listPublishedForHome(3),
      this.contentService.countPublished(),
    ]);
    return {
      stats: { noteCount, galleryCount: recentGallery.length },
      latest,
      recentGallery,
    };
  }
}
