/**
 * PublishAllService — 一键「发布全部内容的最新提交版本」。
 *
 * 用途:
 * - 灾后/迁移:从远端恢复后所有内容是未发布状态(发布状态=publishedVersion,不进 Git),
 *   点一下把所有内容的最新版重新上线,免去逐条手动发布。
 * - 也是发布状态从 Git 迁出后的过渡手段(替代一次性迁移脚本)。
 *
 * 设计:本服务只按 scope **路由**到对应 view service,不掺和各 scope 的发布细节——
 * 每个 view service 实现统一的 ScopePublisher.publishLatest(各自决定怎么发:notes/gallery
 * 发整体最新版、anthology 发全部条目+整集)。这样调用方对称、无 scope 特判逻辑泄漏。
 * 不可发布的项(无已提交版本 / 空文集 / 无可发布条目)被跳过,不中断整体。
 */
import { Injectable, Logger } from '@nestjs/common';
import { NavigationRepository } from '../navigation/navigation.repository';
import { NoteViewService } from '../workspace/note-view.service';
import { GalleryViewService } from '../workspace/gallery-view.service';
import { AnthologyViewService } from '../workspace/anthology-view.service';

/** 各 scope view service 统一实现:发布该内容的最新版。 */
interface ScopePublisher {
  publishLatest(contentItemId: string): Promise<void>;
}

@Injectable()
export class PublishAllService {
  private readonly logger = new Logger(PublishAllService.name);

  constructor(
    private readonly navigationRepository: NavigationRepository,
    private readonly noteViewService: NoteViewService,
    private readonly galleryViewService: GalleryViewService,
    private readonly anthologyViewService: AnthologyViewService,
  ) {}

  /** scope → 对应的发布器;未知 scope 返回 null(跳过)。 */
  private publisherForScope(scope: string | undefined): ScopePublisher | null {
    switch (scope) {
      case 'notes':
        return this.noteViewService;
      case 'gallery':
        return this.galleryViewService;
      case 'anthology':
        return this.anthologyViewService;
      default:
        return null;
    }
  }

  /** 发布全部内容的最新版本,返回发布/跳过计数。 */
  async publishAllLatest(): Promise<{ published: number; skipped: number }> {
    const nodes = await this.navigationRepository.listAll();
    let published = 0;
    let skipped = 0;

    for (const node of nodes) {
      if (!node.contentItemId) continue; // 文件夹节点无内容,跳过
      const publisher = this.publisherForScope(node.scope);
      if (!publisher) {
        skipped++;
        continue;
      }
      try {
        await publisher.publishLatest(node.contentItemId);
        published++;
      } catch (err: unknown) {
        // 不可发布(无已提交版本 / 空文集等)→ 跳过,不中断
        skipped++;
        this.logger.debug(
          `publish-all 跳过 ${node.contentItemId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`publish-all 完成:发布 ${published}、跳过 ${skipped}`);
    return { published, skipped };
  }
}
