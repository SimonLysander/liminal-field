/**
 * HomeController — 首页聚合端点。
 *
 * 独立模块避免 ContentModule ↔ WorkspaceModule 循环依赖：
 * HomeModule 同时导入两者，聚合跨 scope 数据。
 *
 * 返回字段：
 *   notes    - 最近笔记（含字数）
 *   gallery  - 近期图集（含张数）
 *   anthology - 近期文集容器（已发布，最多 6，按 publishedAt 倒序）
 *   digest   - 最新简报摘要（全局，最多 3，按 publishedAt 倒序）
 */
import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ContentService } from '../content/content.service';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import { GalleryViewService } from '../workspace/gallery-view.service';
import { DigestReportRepository } from '../digest/digest-report.repository';

@Controller()
export class HomeController {
  constructor(
    private readonly contentService: ContentService,
    private readonly contentRepository: ContentRepository,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly navigationRepository: NavigationRepository,
    private readonly galleryViewService: GalleryViewService,
    private readonly digestReportRepository: DigestReportRepository,
  ) {}

  /** 首页数据：最近笔记（含字数） + 近期图集（含张数） + 近期文集 + 最新简报。 */
  @Public()
  @Get('home')
  async getHome() {
    // Step 1：并行拉取 notes 和 anthology 的导航节点（两者都需要 navigationRepository）
    const [notesNodes, allAnthologyNodes] = await Promise.all([
      this.navigationRepository.listByScope('notes'),
      this.navigationRepository.listByScope('anthology'),
    ]);

    const noteContentIds = notesNodes
      .map((n) => n.contentItemId?.toString())
      .filter((id): id is string => !!id);

    // anthology 顶层容器节点：parentId 为 undefined = 容器（子条目 parentId 有值）
    const containerNodes = allAnthologyNodes.filter((n) => !n.parentId);

    // Step 2：并行拉取 notes 内容 / gallery / anthology ContentItems / digest 简报
    const [latestNotes, recentGallery, anthologyItems, latestDigests] =
      await Promise.all([
        this.contentService.getPublishedLatest(6, noteContentIds),
        this.galleryViewService.listPublishedForHome(6),
        // 批量加载文集容器的 ContentItem（需要 publishedVersion / publishedAt / title）
        Promise.all(
          containerNodes.map((n) =>
            this.contentRepository.findById(n.contentItemId),
          ),
        ),
        // 全局最新 3 条简报，不限 topic
        this.digestReportRepository.findGlobalLatest(3),
      ]);

    // anthology：过滤已发布容器 → 按 publishedAt 倒序 → 取 top 6
    const publishedPairs = containerNodes
      .map((node, i) => ({ node, item: anthologyItems[i] }))
      .filter(({ item }) => !!item?.publishedVersion)
      .sort(
        (a, b) =>
          // publishedAt 优先，回退 updatedAt（两者均为 Date）
          (b.item!.publishedAt ?? b.item!.updatedAt).getTime() -
          (a.item!.publishedAt ?? a.item!.updatedAt).getTime(),
      )
      .slice(0, 6);

    // Step 3：并行计算 notes 字数 + anthology 子条目数（互不依赖）
    const topNodeIds = publishedPairs.map((p) => p.node._id.toString());
    const [notesWithWordCount, entryCountMap] = await Promise.all([
      // 批量加载 snapshot 计算字数（仅 6 条，开销可接受）
      Promise.all(
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
              const cjk = (text.match(/[一-鿿㐀-䶿]/g) ?? []).length;
              const latin = text
                .replace(/[一-鿿㐀-䶿]/g, '')
                .split(/\s+/)
                .filter(Boolean).length;
              wordCount = cjk + latin;
            }
          }
          return { ...note, wordCount };
        }),
      ),
      // 批量聚合每个文集容器的子条目数（aggregate $group，单次 DB 往返）
      // 注：这里计 ALL 子节点数（含未发布），与 home 卡片"共 N 篇"语义一致
      topNodeIds.length > 0
        ? this.navigationRepository.countChildrenByParentIds(
            topNodeIds,
            'anthology',
          )
        : Promise.resolve<Record<string, number>>({}),
    ]);

    // 组装文集列表 DTO
    const anthologyResult = publishedPairs.map(({ node, item }) => ({
      id: item!._id,
      // title 优先取已发布版本标题（展示端语义），回退 latestVersion，再回退 nav node.name
      title:
        item!.publishedVersion!.title ||
        item!.latestVersion?.title ||
        node.name,
      entryCount: entryCountMap[node._id.toString()] ?? 0,
      // date 用 publishedAt（文集首次上线时间）
      date: item!.publishedAt?.toISOString() ?? null,
    }));

    // 组装简报摘要列表 DTO（headline + deck 供首页卡片展示）
    const digestResult = latestDigests.map((r) => ({
      topicId: r.topicId,
      reportId: r._id,
      headline: r.headline,
      deck: r.deck,
      publishedAt: r.publishedAt.toISOString(),
    }));

    return {
      notes: notesWithWordCount,
      gallery: recentGallery,
      anthology: anthologyResult,
      digest: digestResult,
    };
  }
}
