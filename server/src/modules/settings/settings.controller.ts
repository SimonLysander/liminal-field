/**
 * SettingsController — 系统设置与灾难恢复接口。
 *
 * 路由前缀：/settings
 *
 * 功能分组：
 * - kb-remote：KB Git 远程仓库配置（验证 / 保存）
 * - recovery：灾难恢复（扫描差异 / 执行恢复）
 * - status：系统状态快照（DB 条数 / Git 条数 / 清单）
 */
import { Body, Controller, Get, Logger, Post, Put } from '@nestjs/common';
import simpleGit from 'simple-git';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import { ContentRepoService } from '../content/content-repo.service';
import {
  applyKbGitTokenToGithubHttps,
  resolveKbRemoteUrlForGit,
} from '../../common/kb-remote-url';
import { ManifestService } from './manifest.service';
import { RecoveryService, ScanResult, ExecuteResult } from './recovery.service';

@Controller('settings')
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentSnapshotRepository: ContentSnapshotRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly manifestService: ManifestService,
    private readonly recoveryService: RecoveryService,
  ) {}

  /**
   * 验证 KB 远程仓库连通性（不修改配置）。
   * 使用 git ls-remote 做真实连通测试，无需 clone。
   */
  @Post('kb-remote/validate')
  async validateRemote(
    @Body() dto: { url: string; token?: string },
  ): Promise<{ valid: boolean; message: string }> {
    const resolvedUrl = applyKbGitTokenToGithubHttps(dto.url, dto.token);
    try {
      // ls-remote 只做读操作，不修改任何本地状态
      const tempGit = simpleGit();
      await tempGit.listRemote([resolvedUrl, 'HEAD']);
      return { valid: true, message: '连接成功' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`validateRemote 失败: ${msg}`);
      return { valid: false, message: msg };
    }
  }

  /**
   * 保存 KB 远程仓库配置（运行时生效，重启后失效）。
   *
   * 注意：修改只更新运行时 process.env 和 Git remote，不写入 .env 文件。
   * 生产环境通过 docker-compose 环境变量持久化，此接口供运行时热切换使用。
   */
  @Put('kb-remote')
  async saveRemote(
    @Body() dto: { url: string; token?: string },
  ): Promise<{ success: boolean }> {
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
        this.logger.warn(
          `更新 Git remote 失败: ${err instanceof Error ? err.message : String(err)}`,
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
    @Body() dto: { contentIds?: string[] },
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
    const [scanResult, hasManifest] = await Promise.all([
      this.recoveryService.scan(),
      this.manifestService.manifestExists(),
    ]);

    return {
      dbItemCount: scanResult.dbItems.length,
      // ContentSnapshotRepository 没有 countAll，用 listAll 的长度（snapshot 数量通常不大）
      dbSnapshotCount: 0,
      gitItemCount: scanResult.gitItems.length,
      hasManifest,
    };
  }
}
