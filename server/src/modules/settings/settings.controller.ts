/**
 * SettingsController — 系统设置与灾难恢复接口。
 *
 * 路由前缀：/settings
 *
 * 功能分组：
 * - kb-remote：KB Git 远程仓库配置（验证 / 保存）
 * - recovery：灾难恢复（扫描差异 / 执行恢复）
 * - status：系统状态快照（DB 条数 / Git 条数 / 清单）
 * - sync：远端同步（推送 / 拉取，从 AuthController 迁移）
 */
import { Body, Controller, Get, Logger, Post, Put } from '@nestjs/common';
import { rm } from 'fs/promises';
import { join } from 'path';
import simpleGit from 'simple-git';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { ContentGitService } from '../content/content-git.service';
import {
  applyKbGitTokenToGithubHttps,
  resolveKbRemoteUrlForGit,
  redactKbRemoteUrlForLog,
} from '../../common/kb-remote-url';
import { ManifestService } from './manifest.service';
import { RecoveryService, ScanResult, ExecuteResult } from './recovery.service';
import { KbRemoteDto, ExecuteRecoveryDto } from './dto/settings.dto';
import { NavigationRepository } from '../navigation/navigation.repository';

@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentSnapshotRepository: ContentSnapshotRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly manifestService: ManifestService,
    private readonly recoveryService: RecoveryService,
    private readonly contentGitService: ContentGitService,
    private readonly navigationRepository: NavigationRepository,
  ) {}

  /**
   * 验证 KB 远程仓库连通性（不修改配置）。
   * 使用 git ls-remote 做真实连通测试，无需 clone。
   */
  @Post('kb-remote/validate')
  async validateRemote(
    @Body() dto: KbRemoteDto,
  ): Promise<{ valid: boolean; message: string }> {
    const resolvedUrl = applyKbGitTokenToGithubHttps(dto.url, dto.token);
    try {
      // ls-remote 只做读操作，不修改任何本地状态
      const tempGit = simpleGit();
      await tempGit.listRemote([resolvedUrl, 'HEAD']);
      return { valid: true, message: '连接成功' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // 脱敏后再写日志和返回前端，防止 simple-git 的错误消息携带含 PAT token 的完整 URL
      const redactedMsg = redactKbRemoteUrlForLog(msg);
      this.logger.warn(`validateRemote 失败: ${redactedMsg}`);
      return { valid: false, message: redactedMsg };
    }
  }

  /**
   * 保存 KB 远程仓库配置（运行时生效，重启后失效）。
   *
   * 注意：修改只更新运行时 process.env 和 Git remote，不写入 .env 文件。
   * 生产环境通过 docker-compose 环境变量持久化，此接口供运行时热切换使用。
   */
  @Put('kb-remote')
  async saveRemote(@Body() dto: KbRemoteDto): Promise<{ success: boolean }> {
    // 更新运行时环境变量
    process.env.KB_REMOTE_URL = dto.url;
    if (dto.token !== undefined) {
      process.env.KB_GIT_TOKEN = dto.token;
    }

    // 同步更新 Git remote（使用带 token 的完整 URL）
    const resolvedUrl = resolveKbRemoteUrlForGit();
    if (resolvedUrl) {
      try {
        const git = simpleGit(this.contentRepoService.repoRoot);
        const remotes = await git.getRemotes(true);
        const origin = remotes.find((r) => r.name === 'origin');
        if (!origin) {
          await git.addRemote('origin', resolvedUrl);
        } else {
          await git.remote(['set-url', 'origin', resolvedUrl]);
        }
        this.logger.log('KB remote updated');
      } catch (err: unknown) {
        // 脱敏后写日志，防止 simple-git 错误消息携带含 PAT token 的 URL
        const rawMsg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `更新 Git remote 失败: ${redactKbRemoteUrlForLog(rawMsg)}`,
        );
        // Git remote 更新失败不阻断响应，env 已更新
      }
    }

    return { success: true };
  }

  /**
   * 扫描 Git 仓库与 MongoDB 差异，返回待恢复列表。
   * 纯读操作，不修改任何数据，可安全多次调用。
   */
  @Post('recovery/scan')
  async scanRecovery(): Promise<ScanResult> {
    return this.recoveryService.scan();
  }

  /**
   * 执行灾难恢复。
   *
   * @param dto.contentIds 指定要恢复的 contentId；不传时自动取扫描结果中 missingInDb。
   */
  @Post('recovery/execute')
  async executeRecovery(
    @Body() dto: ExecuteRecoveryDto,
  ): Promise<ExecuteResult> {
    return this.recoveryService.execute(dto.contentIds);
  }

  /**
   * 系统状态快照：供设置页面展示概览数据。
   * 各项查询均为轻量操作（count / exists），不加载文档内容。
   */
  @Get('status')
  async getStatus(): Promise<{
    dbItemCount: number;
    dbSnapshotCount: number;
    gitItemCount: number;
    hasManifest: boolean;
  }> {
    const [scanResult, hasManifest, dbSnapshotCount] = await Promise.all([
      this.recoveryService.scan(),
      this.manifestService.manifestExists(),
      this.contentSnapshotRepository.countAll(),
    ]);

    return {
      dbItemCount: scanResult.dbItems.length,
      dbSnapshotCount,
      gitItemCount: scanResult.gitItems.length,
      hasManifest,
    };
  }

  /**
   * 同步状态查询（从 AuthController 迁移）。
   */
  @Get('sync-status')
  async getSyncStatus() {
    return this.contentGitService.getSyncStatus();
  }

  /**
   * 推送本地数据到远端。
   * 写 manifest → commit → push，一步完成。
   */
  @Post('push-to-remote')
  async pushToRemote(): Promise<{ success: boolean; message: string }> {
    // 推送前写入清单
    try {
      await this.manifestService.writeManifest();
      await this.contentGitService.commitManifestIfChanged();
    } catch (err: unknown) {
      this.logger.warn(
        `写入清单失败，继续推送: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return this.contentGitService.pushCurrentBranch();
  }

  /**
   * 从远端同步：清空本地 → pull → 自动恢复 MongoDB。
   * 破坏性操作，前端需二次确认。
   */
  @Post('sync-from-remote')
  async syncFromRemote(): Promise<{
    success: boolean;
    recovered: number;
    errors: string[];
    message: string;
  }> {
    // 1. 清空 MongoDB
    const deletedItems = await this.contentRepository.deleteAll();
    await this.contentSnapshotRepository.deleteAll();
    await this.navigationRepository.deleteAll();
    this.logger.log(`Cleared MongoDB: ${deletedItems} content items`);

    // 2. 清空 Git content/ 目录 + 清单文件
    const contentDir = join(this.contentRepoService.repoRoot, 'content');
    try {
      await rm(contentDir, { recursive: true, force: true });
    } catch { /* 目录不存在，忽略 */ }
    const manifestPath = join(
      this.contentRepoService.repoRoot,
      '.liminal-field.yaml',
    );
    try {
      await rm(manifestPath, { force: true });
    } catch { /* 文件不存在，忽略 */ }

    // 3. 从远端拉取
    const pullResult = await this.contentGitService.pullFromRemote();
    if (!pullResult.success) {
      return {
        success: false,
        recovered: 0,
        errors: [pullResult.message],
        message: pullResult.message,
      };
    }

    // 4. 扫描并恢复
    const scanResult = await this.recoveryService.scan();
    if (scanResult.missingInDb.length === 0) {
      return {
        success: true,
        recovered: 0,
        errors: [],
        message: '远端仓库无内容可恢复',
      };
    }

    const execResult = await this.recoveryService.execute(
      scanResult.missingInDb,
    );
    return {
      success: execResult.errors.length === 0,
      recovered: execResult.recovered,
      errors: execResult.errors,
      message: `已恢复 ${execResult.recovered} 个内容项`,
    };
  }
}
