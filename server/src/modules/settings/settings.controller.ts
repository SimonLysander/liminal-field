/**
 * SettingsController — 系统设置。
 *
 * 路由前缀：/settings
 *
 * 功能分组：
 * - config：全量配置读取 + 分区保存（sync / storage / integration）
 * - remote-config：远端仓库验证（独立，不修改配置）
 * - status：综合状态（本地计数 + 远端连通）
 * - storage-status：存储诊断（OSS 连通 + Git 仓库状态）
 * - push-to-remote / sync-from-remote：数据同步操作
 */
import { Body, Controller, Get, Logger, Post, Put } from '@nestjs/common';
import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import simpleGit from 'simple-git';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentGitService } from '../content/content-git.service';
import { NavigationRepository } from '../navigation/navigation.repository';
import { OssService } from '../oss/oss.service';
import { ManifestService } from './manifest.service';
import { RecoveryService } from './recovery.service';
import { ArchiveService } from './archive.service';
import {
  SystemConfigService,
  SettingsConfigView,
} from './system-config.service';
import { KbRemoteDto } from './dto/settings.dto';
import {
  applyKbGitTokenToGithubHttps,
  redactKbRemoteUrlForLog,
} from '../../common/kb-remote-url';

@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentSnapshotRepository: ContentSnapshotRepository,
    private readonly navigationRepository: NavigationRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
    private readonly ossService: OssService,
    private readonly manifestService: ManifestService,
    private readonly recoveryService: RecoveryService,
    private readonly archiveService: ArchiveService,
    private readonly systemConfigService: SystemConfigService,
  ) {}

  // ── 全量配置（脱敏读取） ─────────────────────────────────

  @Get('config')
  async getConfig(): Promise<SettingsConfigView> {
    return this.systemConfigService.getConfigView();
  }

  // ── 分区保存 ─────────────────────────────────────────────

  @Put('sync-config')
  async saveSyncConfig(
    @Body()
    dto: {
      url: string;
      token?: string;
      gitAuthorName?: string;
      gitAuthorEmail?: string;
      gitSyncCron?: string;
    },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.saveSyncConfig({
      remoteUrl: dto.url,
      token: dto.token,
      gitAuthorName: dto.gitAuthorName,
      gitAuthorEmail: dto.gitAuthorEmail,
      gitSyncCron: dto.gitSyncCron,
    });
    return { success: true };
  }

  @Put('integration-config')
  async saveIntegrationConfig(
    @Body() dto: { mineruToken?: string },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.saveIntegrationConfig(dto);
    return { success: true };
  }

  // ── 远端连通性验证 ───────────────────────────────────────

  @Post('remote-config/validate')
  async validateRemote(
    @Body() dto: KbRemoteDto,
  ): Promise<{ valid: boolean; message: string }> {
    const resolvedUrl = applyKbGitTokenToGithubHttps(dto.url, dto.token);
    try {
      await simpleGit().listRemote([resolvedUrl, 'HEAD']);
      return { valid: true, message: '连接成功' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const redactedMsg = redactKbRemoteUrlForLog(msg);
      this.logger.warn(`validateRemote 失败: ${redactedMsg}`);
      return { valid: false, message: redactedMsg };
    }
  }

  // ── 综合状态 ─────────────────────────────────────────────

  /** 本地数据计数（纯 MongoDB 查询，无网络调用） */
  @Get('status')
  async getStatus(): Promise<{
    local: {
      contentCount: number;
      snapshotCount: number;
      navigationCount: number;
    };
  }> {
    const [contentCount, snapshotCount, navigationCount] = await Promise.all([
      this.contentRepository.countAll(),
      this.contentSnapshotRepository.countAll(),
      this.navigationRepository.countAll(),
    ]);

    return { local: { contentCount, snapshotCount, navigationCount } };
  }

  // ── 存储状态（诊断用） ───────────────────────────────────

  @Get('storage-status')
  async getStorageStatus(): Promise<{
    oss: { connected: boolean; bucket: string; region: string };
    git: {
      branch: string;
      totalCommits: number;
      unpushedCommits: number;
      lastCommitMessage: string;
      lastCommitTime: string;
      remote: string;
    } | null;
  }> {
    // OSS 连通性
    const ossConnected = this.ossService.isDraftStorageReady();
    const ossRegion = process.env.OSS_REGION || '';
    const ossBucket = process.env.OSS_BUCKET || '';

    // Git 仓库状态
    const gitStatus = await this.contentGitService.getSyncStatus();

    return {
      oss: { connected: ossConnected, bucket: ossBucket, region: ossRegion },
      git: gitStatus,
    };
  }

  // ── 推送到远端 ───────────────────────────────────────────

  /**
   * 推送到远端：写 manifest → commit → 推 workspace + main。
   * 首次推送和日常手动推送共用同一个逻辑。
   */
  @Post('push-to-remote')
  async pushToRemote(): Promise<{ success: boolean; message: string }> {
    try {
      await this.manifestService.writeManifest();
      await this.contentGitService.commitManifestIfChanged();
    } catch (err: unknown) {
      this.logger.warn(
        `写入清单失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 推 workspace（当前工作分支）
    const result = await this.contentGitService.pushCurrentBranch();
    if (!result.success) return result;

    // 同时推 main 分支，确保恢复可用
    await this.contentGitService.pushBranch('main');
    return result;
  }

  // ── 从远端恢复 ───────────────────────────────────────────

  @Post('sync-from-remote')
  async syncFromRemote(): Promise<{
    success: boolean;
    message: string;
    archived: boolean;
    recovered: number;
  }> {
    const localContentCount = await this.contentRepository.countAll();
    let archived = false;

    if (localContentCount > 0) {
      try {
        const archivePath = await this.archiveService.archive();
        archived = true;
        this.logger.log(`本地数据已归档到 ${archivePath}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`归档失败，中止同步: ${msg}`);
        return {
          success: false,
          message: `归档失败，已中止: ${msg}`,
          archived: false,
          recovered: 0,
        };
      }
    }

    await Promise.all([
      this.contentRepository.deleteAll(),
      this.contentSnapshotRepository.deleteAll(),
      this.navigationRepository.deleteAll(),
    ]);
    this.logger.log('MongoDB cleared');

    const contentDir = join(this.contentRepoService.repoRoot, 'content');
    const manifestPath = join(
      this.contentRepoService.repoRoot,
      '.liminal-field.yaml',
    );
    await Promise.all([
      rm(contentDir, { recursive: true, force: true }).catch(() => {}),
      rm(manifestPath, { force: true }).catch(() => {}),
    ]);

    const pullResult = await this.contentGitService.pullFromRemote();
    if (!pullResult.success) {
      return {
        success: false,
        message: pullResult.message,
        archived,
        recovered: 0,
      };
    }

    const scanResult = await this.recoveryService.scan();
    if (scanResult.missingInDb.length === 0) {
      return {
        success: true,
        message: '远端仓库无内容可恢复',
        archived,
        recovered: 0,
      };
    }

    const execResult = await this.recoveryService.execute(
      scanResult.missingInDb,
    );
    return {
      success: execResult.errors.length === 0,
      message:
        execResult.errors.length === 0
          ? `已恢复 ${execResult.recovered} 个内容项`
          : `恢复完成但有错误: ${execResult.errors[0]}`,
      archived,
      recovered: execResult.recovered,
    };
  }

  // ── 一键清空本地 ─────────────────────────────────────────

  /**
   * 清空所有本地数据：可选先归档 → 清 MongoDB + Git 仓库内容。
   * archive=true 时先归档到磁盘再清空。
   */
  @Post('clear-local')
  async clearLocal(
    @Body() dto: { archive?: boolean },
  ): Promise<{ success: boolean; message: string; archived: boolean }> {
    let archived = false;

    // 归档
    if (dto.archive) {
      const contentCount = await this.contentRepository.countAll();
      if (contentCount > 0) {
        const archivePath = await this.archiveService.archive();
        archived = true;
        this.logger.log(`归档到 ${archivePath}`);
      }
    }

    // 清 MongoDB
    const [items, snapshots, nav] = await Promise.all([
      this.contentRepository.deleteAll(),
      this.contentSnapshotRepository.deleteAll(),
      this.navigationRepository.deleteAll(),
    ]);
    this.logger.log(
      `Cleared MongoDB: ${items} items, ${snapshots} snapshots, ${nav} nav nodes`,
    );

    // 清空 Git 仓库（删除目录内所有内容，包括 .git）
    const repoRoot = this.contentRepoService.repoRoot;
    const entries = await readdir(repoRoot).catch((): string[] => []);
    await Promise.all(
      entries.map((entry: string) =>
        rm(join(repoRoot, entry), { recursive: true, force: true }),
      ),
    );

    // 重新初始化空仓库（不需要重启容器）
    await this.contentGitService.reinitRepo();

    const note = archived ? '（已归档）' : '';
    return {
      success: true,
      archived,
      message: `已清空 ${items} 个内容项${note}`,
    };
  }

  // ── Git 同步状态（兼容 SyncDialog） ─────────────────────

  @Get('sync-status')
  async getSyncStatus() {
    return this.contentGitService.getSyncStatus();
  }

  // ── 灾难恢复 ────────────────────────────────────────────

  @Post('recovery/scan')
  async scanRecovery() {
    return this.recoveryService.scan();
  }

  @Post('recovery/execute')
  async executeRecovery(@Body() dto: { contentIds?: string[] }) {
    return this.recoveryService.execute(dto.contentIds);
  }
}
