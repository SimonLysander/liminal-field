/**
 * SettingsController — 系统设置。
 *
 * 路由前缀：/settings
 *
 * 功能分组：
 * - config：全量配置读取 + 分区保存（sync / storage / integration）
 * - remote-config：远端仓库验证（独立，不修改配置）
 * - ai-providers：多提供商管理（添加 / 删除 / 切换启用 / 编辑 tier 绑定 / 连接验证）
 * - ai-system-prompt：全局 system prompt 保存
 * - status：综合状态（本地计数 + 远端连通）
 * - storage-status：存储诊断（OSS 连通 + Git 仓库状态）
 * - push-to-remote / sync-from-remote：数据同步操作
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
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
import { LocalResetService } from './local-reset.service';
import { PublishAllService } from './publish-all.service';
import {
  SystemConfigService,
  SettingsConfigView,
} from './system-config.service';
import { KbRemoteDto } from './dto/settings.dto';
import {
  applyKbGitTokenToGithubHttps,
  redactKbRemoteUrlForLog,
} from '../../common/kb-remote-url';

/**
 * AI 提供商预设（baseUrl 由后端维护，前端只传 provider id）。
 * contextWindow:各家旗舰模型的上下文窗口(token)，作为 compaction 计算的分母预设值，用户可在 UI 覆盖。
 * 添加新提供商时只需在此处追加，无需改动其他逻辑。
 */
const AI_PROVIDER_PRESETS: Record<
  string,
  { name: string; baseUrl: string; contextWindow: number }
> = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    contextWindow: 64000,
  },
  zhipu: {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    contextWindow: 32000,
  },
  moonshot: {
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    contextWindow: 32000,
  },
};

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
    private readonly localResetService: LocalResetService,
    private readonly publishAllService: PublishAllService,
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
      gitSyncEnabled?: boolean;
    },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.saveSyncConfig({
      remoteUrl: dto.url,
      token: dto.token,
      gitAuthorName: dto.gitAuthorName,
      gitAuthorEmail: dto.gitAuthorEmail,
      gitSyncCron: dto.gitSyncCron,
      gitSyncEnabled: dto.gitSyncEnabled,
    });
    return { success: true };
  }

  @Put('integration-config')
  async saveIntegrationConfig(
    @Body() dto: { mineruToken?: string; tavilyApiKey?: string },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.saveIntegrationConfig(dto);
    return { success: true };
  }

  // ── AI 多提供商管理 ────────────────────────────────────────

  /**
   * 添加 AI 提供商（三 tier 模型绑定）。
   * baseUrl 从 AI_PROVIDER_PRESETS 查找，不由前端传入，防止任意 URL 注入。
   */
  @Post('ai-providers')
  async addAiProvider(
    @Body()
    dto: {
      provider: string;
      apiKey: string;
      flashModel: string;
      standardModel: string;
      thinkModel: string;
      visionModel?: string;
    },
  ): Promise<{ success: boolean; id: string }> {
    const preset = AI_PROVIDER_PRESETS[dto.provider];
    if (!preset) {
      throw new Error(`Unknown provider: ${dto.provider}`);
    }
    const id = nanoid(8);
    await this.systemConfigService.addAiProvider({
      id,
      provider: dto.provider,
      name: preset.name,
      baseUrl: preset.baseUrl,
      apiKey: dto.apiKey,
      flashModel: dto.flashModel,
      standardModel: dto.standardModel,
      thinkModel: dto.thinkModel,
      visionModel: dto.visionModel,
      contextWindow: preset.contextWindow,
    });
    return { success: true, id };
  }

  /** 删除 AI 提供商（by id） */
  @Delete('ai-providers/:id')
  async deleteAiProvider(
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.deleteAiProvider(id);
    return { success: true };
  }

  /** 切换当前启用的 AI 提供商 */
  @Put('ai-providers/:id/activate')
  async activateAiProvider(
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.setActiveAiProvider(id);
    return { success: true };
  }

  /**
   * 编辑 AI 提供商的 tier 绑定或 API Key。
   * 只更新传入的字段，未传字段保持不变。
   */
  @Put('ai-providers/:id')
  async updateAiProvider(
    @Param('id') id: string,
    @Body()
    dto: {
      flashModel?: string;
      standardModel?: string;
      thinkModel?: string;
      visionModel?: string;
      apiKey?: string;
    },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.updateAiProvider(id, dto);
    return { success: true };
  }

  /**
   * 获取提供商的可用模型列表。
   * 调用提供商的 GET /models 端点（OpenAI 兼容标准），返回模型 ID 列表。
   */
  @Post('ai-providers/list-models')
  async listProviderModels(
    @Body() dto: { provider: string; apiKey: string },
  ): Promise<{ models: string[] }> {
    const preset = AI_PROVIDER_PRESETS[dto.provider];
    if (!preset) {
      return { models: [] };
    }
    try {
      const url = `${preset.baseUrl}/models`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${dto.apiKey}` },
      });
      if (!res.ok) {
        this.logger.warn(
          `listProviderModels 失败 (${dto.provider}): ${res.status}`,
        );
        return { models: [] };
      }
      const json = (await res.json()) as {
        data?: Array<{ id: string }>;
      };
      // OpenAI 标准格式：{ data: [{ id: 'model-name', ... }] }
      const models = (json.data ?? [])
        .map((m) => m.id)
        .sort((a, b) => a.localeCompare(b));
      return { models };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`listProviderModels 异常 (${dto.provider}): ${msg}`);
      return { models: [] };
    }
  }

  /**
   * 验证 AI 提供商连接：用标准 tier 模型发送一条极小请求。
   * 返回 valid: true/false 和错误信息，前端在"验证并保存"时先调用此接口。
   */
  @Post('ai-providers/validate')
  async validateAiProvider(
    @Body() dto: { provider: string; apiKey: string; standardModel: string },
  ): Promise<{ valid: boolean; message: string }> {
    const preset = AI_PROVIDER_PRESETS[dto.provider];
    if (!preset) {
      return { valid: false, message: `未知提供商: ${dto.provider}` };
    }
    try {
      const provider = createOpenAICompatible({
        name: dto.provider,
        baseURL: preset.baseUrl,
        apiKey: dto.apiKey,
      });
      await generateText({
        model: provider(dto.standardModel),
        prompt: 'Hi',
        maxOutputTokens: 8,
      });
      return { valid: true, message: '连接验证成功' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `validateAiProvider 失败 (${dto.provider}/${dto.standardModel}): ${msg}`,
      );
      return { valid: false, message: msg };
    }
  }

  /** 保存全局 AI system prompt */
  @Put('ai-system-prompt')
  async saveAiSystemPrompt(
    @Body() dto: { prompt: string },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.saveAiSystemPrompt(dto.prompt);
    return { success: true };
  }

  // ── 所有者身份管理 ─────────────────────────────────────────

  @Get('owner-profile')
  async getOwnerProfile() {
    return this.systemConfigService.getOwnerProfile();
  }

  @Put('owner-profile')
  async saveOwnerProfile(
    @Body() dto: { name?: string; bio?: string },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.saveOwnerProfile(dto);
    return { success: true };
  }

  // ── Agent 入口配置管理 ────────────────────────────────────

  /** 获取所有 agent 入口配置 */
  @Get('agent-configs')
  async getAgentConfigs() {
    return this.systemConfigService.getAgentConfigs();
  }

  /** 返回可用工具池(供 AgentTab UI 渲染 checkbox 列表) */
  @Get('agent-configs/available-tools')
  async getAvailableTools(): Promise<string[]> {
    return this.systemConfigService.getAvailableTools();
  }

  /**
   * 保存 agent 入口配置（upsert by key）。
   * key 匹配则更新，不存在则新增。
   */
  @Put('agent-configs/:key')
  async saveAgentConfig(
    @Param('key') key: string,
    @Body()
    dto: {
      name?: string;
      description?: string;
      enabled?: boolean;
      systemPrompt?: string;
      tools?: string[];
      tier?: string;
      providerId?: string;
      flashProviderId?: string;
      standardProviderId?: string;
      thinkProviderId?: string;
      visionProviderId?: string;
    },
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.saveAgentConfig(key, dto);
    return { success: true };
  }

  /** 删除 agent 入口配置（by key） */
  @Delete('agent-configs/:key')
  async deleteAgentConfig(
    @Param('key') key: string,
  ): Promise<{ success: boolean }> {
    await this.systemConfigService.deleteAgentConfig(key);
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
    // git 字段类型跟随 getSyncStatus 实际返回(含 syncState),避免手写注解漂移
    git: Awaited<ReturnType<ContentGitService['getSyncStatus']>>;
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
    // 推送前先把所有 pending snapshot 写入 git（不等 cron）
    await this.contentGitService.retryPendingArchives();

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
    // 同清草稿:草稿是本地 WIP、远端没有,内容用远端覆盖后旧草稿即孤儿。
    // 不清 session 记忆/OSS——内容会以相同 id 从远端恢复,记忆仍有效、资产由恢复链重传。
    const draftsCleared = await this.localResetService.clearDrafts();
    this.logger.log(`MongoDB cleared (含 ${draftsCleared} 条草稿)`);

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

    // 清 MongoDB:content/snapshot/navigation 三件套
    const [items, snapshots, nav] = await Promise.all([
      this.contentRepository.deleteAll(),
      this.contentSnapshotRepository.deleteAll(),
      this.navigationRepository.deleteAll(),
    ]);
    // 连带清内容耦合的本地数据:草稿 + session 记忆 + OSS 资产(保留 user 画像)。
    // 历史踩坑:漏清草稿 → 内容删了草稿成孤儿、下次撞 id 读到幽灵草稿。
    const [drafts, sessionMemories] = await Promise.all([
      this.localResetService.clearDrafts(),
      this.localResetService.clearSessionMemories(),
    ]);
    await this.localResetService.clearContentAssets();
    this.logger.log(
      `Cleared MongoDB: ${items} items, ${snapshots} snapshots, ${nav} nav nodes, ` +
        `${drafts} drafts, ${sessionMemories} session memories (+ OSS assets)`,
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

  // ── 一键发布全部最新版 ───────────────────────────────────

  /**
   * 发布全部内容的最新提交版本(按 scope 分派:anthology 发布所有条目+整集,其余发布最新)。
   * 用于灾后/从远端恢复后一键重新上线(发布状态不进 Git,恢复后默认全未发布)。
   */
  @Post('publish-all')
  async publishAll(): Promise<{
    success: boolean;
    published: number;
    skipped: number;
  }> {
    const { published, skipped } =
      await this.publishAllService.publishAllLatest();
    return { success: true, published, skipped };
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
