import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { NavigationRepository } from '../navigation/navigation.repository';
import { ContentRepoService } from '../content/content-repo.service';

/**
 * ArchiveService — 本地数据归档。
 *
 * 在 sync-from-remote 执行清空前，将 MongoDB 三个集合导出为 JSON 文件。
 * 归档目录：{repoRoot 的父目录}/liminal-field-kb-archives/YYYY-MM-DDTHHMMSS/
 * 与 kb 仓库同级，不在 Git 仓库内，不会被 git 追踪或误删。
 */
@Injectable()
export class ArchiveService {
  private readonly logger = new Logger(ArchiveService.name);
  private readonly archiveRoot: string;

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentSnapshotRepository: ContentSnapshotRepository,
    private readonly navigationRepository: NavigationRepository,
    contentRepoService: ContentRepoService,
  ) {
    // 放到 repoRoot 的同级目录，如 /data/liminal-field-kb → /data/liminal-field-kb-archives
    this.archiveRoot = join(
      dirname(contentRepoService.repoRoot),
      'liminal-field-kb-archives',
    );
  }

  /**
   * 归档当前 MongoDB 数据到本地磁盘。
   * 返回归档目录路径，失败时抛出异常（调用方应中止后续清空操作）。
   */
  async archive(): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const archiveDir = join(this.archiveRoot, timestamp);
    await mkdir(archiveDir, { recursive: true });

    // 并行读取三个集合
    const [contentItems, snapshots, navigationNodes] = await Promise.all([
      this.contentRepository.listAll(),
      this.contentSnapshotRepository.listAll(),
      this.navigationRepository.listAll(),
    ]);

    // 并行写入 JSON 文件
    await Promise.all([
      writeFile(
        join(archiveDir, 'content-items.json'),
        JSON.stringify(contentItems, null, 2),
        'utf8',
      ),
      writeFile(
        join(archiveDir, 'content-snapshots.json'),
        JSON.stringify(snapshots, null, 2),
        'utf8',
      ),
      writeFile(
        join(archiveDir, 'navigation-nodes.json'),
        JSON.stringify(navigationNodes, null, 2),
        'utf8',
      ),
    ]);

    const total =
      contentItems.length + snapshots.length + navigationNodes.length;
    this.logger.log(`Archived ${total} documents to ${archiveDir}`);

    return archiveDir;
  }
}
