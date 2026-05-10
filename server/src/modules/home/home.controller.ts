/**
 * HomeController — 首页聚合端点。
 *
 * 独立模块避免 ContentModule ↔ WorkspaceModule 循环依赖：
 * HomeModule 同时导入两者，聚合跨 scope 数据。
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ContentService } from '../content/content.service';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import { GalleryViewService } from '../workspace/gallery-view.service';

@Controller()
export class HomeController {
  constructor(
    private readonly contentService: ContentService,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly navigationRepository: NavigationRepository,
    private readonly galleryViewService: GalleryViewService,
  ) {}

  /** 首页数据：最近笔记（含字数） + 近期图集（含张数）。 */
  @Public()
  @Get('home')
  async getHome() {
    // 通过 navigation 获取 notes scope 的 contentItemIds，实现 scope 隔离
    const notesNodes = await this.navigationRepository.listByScope('notes');
    const noteContentIds = notesNodes
      .map((n) => n.contentItemId?.toString())
      .filter((id): id is string => !!id);

    const [latestNotes, recentGallery] = await Promise.all([
      this.contentService.getPublishedLatest(6, noteContentIds),
      this.galleryViewService.listPublishedForHome(6),
    ]);

    // 批量加载 snapshot 计算字数（仅 6 条，开销可接受）
    const notesWithWordCount = await Promise.all(
      latestNotes.map(async (note) => {
        const vid =
          String(
            note.publishedVersion?.versionId ??
              note.latestVersion?.versionId ??
              '',
          ) || undefined;
        let wordCount = 0;
        if (vid) {
          const snapshot = await this.snapshotRepository.findByVersionId(vid);
          if (snapshot?.bodyMarkdown) {
            const text = snapshot.bodyMarkdown
              .replace(/^---[\s\S]*?---\s*/m, '')
              .replace(/[#*_[\]()>`~\\|>-]/g, '');
            const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? [])
              .length;
            const latin = text
              .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, '')
              .split(/\s+/)
              .filter(Boolean).length;
            wordCount = cjk + latin;
          }
        }
        return { ...note, wordCount };
      }),
    );

    return {
      notes: notesWithWordCount,
      gallery: recentGallery,
    };
  }
}
