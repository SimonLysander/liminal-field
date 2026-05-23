/**
 * PublishAllService — 一键「发布全部内容的最新提交版本」。
 *
 * 用途:
 * - 灾后/迁移:从远端恢复后所有内容是未发布状态(发布状态不进 Git,见 EntryPublishState
 *   注释),点一下把所有内容的最新版重新上线,免去逐条手动发布。
 * - 也是发布状态从 Git 迁出后的过渡手段(替代一次性迁移脚本)。
 *
 * 按 scope 分派:
 * - anthology:发布所有有内容的条目(publishAllEntries)+ 整集上线(publishAnthology)
 * - notes/gallery:发布最新版本(publishVersion)
 * 不可发布的项(无已提交版本 / 空文集 / 无可发布条目)被跳过,不中断整体。
 */
import { Injectable, Logger } from '@nestjs/common';
import { NavigationRepository } from '../navigation/navigation.repository';
import { ContentService } from '../content/content.service';
import { AnthologyViewService } from '../workspace/anthology-view.service';

@Injectable()
export class PublishAllService {
  private readonly logger = new Logger(PublishAllService.name);

  constructor(
    private readonly navigationRepository: NavigationRepository,
    private readonly contentService: ContentService,
    private readonly anthologyViewService: AnthologyViewService,
  ) {}

  /** 发布全部内容的最新版本,返回发布/跳过计数。 */
  async publishAllLatest(): Promise<{ published: number; skipped: number }> {
    const nodes = await this.navigationRepository.listAll();
    let published = 0;
    let skipped = 0;

    for (const node of nodes) {
      if (!node.contentItemId) continue; // 文件夹节点无内容,跳过
      try {
        if (node.scope === 'anthology') {
          // 先把所有有内容的条目发布,再整集上线(无可发布条目时 publishAnthology 抛错被跳过)
          await this.anthologyViewService.publishAllEntries(node.contentItemId);
          await this.anthologyViewService.publishAnthology(node.contentItemId);
        } else {
          await this.contentService.publishVersion(node.contentItemId);
        }
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
