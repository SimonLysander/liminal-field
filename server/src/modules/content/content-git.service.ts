import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Mutex } from 'async-mutex';
import { existsSync } from 'fs';
import { mkdir, readdir, rm } from 'fs/promises';
import { isAbsolute, join, relative } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  redactKbRemoteUrlForLog,
  resolveKbRemoteUrlForGit,
} from '../../common/kb-remote-url';
import { ContentVersion } from './content-item.entity';
import { ContentSnapshotRepository } from './content-snapshot.repository';
import { ContentRepository } from './content.repository';
import { ContentRepoService } from './content-repo.service';

@Injectable()
export class ContentGitService implements OnModuleInit {
  private readonly logger = new Logger(ContentGitService.name);

  private static readonly defaultAuthorName = 'Liminal Field';
  private static readonly defaultAuthorEmail = 'no-reply@liminal-field.local';

  private readonly repoRoot: string;
  private git: SimpleGit;
  /** Git 写操作互斥锁：add → diff → commit 必须原子化，防止并发请求交叉污染 staged 区域 */
  private readonly writeLock = new Mutex();
  /** init 结束后写入，供 StartupDiagnostics 打出与原先单行日志同等粒度的一行摘要 */
  private kbGitSummaryLine: string | null = null;

  constructor(
    private readonly contentRepoService: ContentRepoService,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly contentRepository: ContentRepository,
  ) {
    // 与 ContentRepoService 共用已解析的绝对路径（含相对配置、目录已 ensure）
    this.repoRoot = this.contentRepoService.repoRoot;
    this.git = simpleGit(this.repoRoot);
  }

  /** 若在 onModuleInit 前调用则为 null；成功后为 OK 行，失败为 FAILED 行 */
  getKbGitSummaryLine(): string | null {
    return this.kbGitSummaryLine;
  }

  /**
   * KB git 仓库完整初始化流程：
   *
   * 1. 仓库不存在 → 根据 KB_REMOTE_URL 决定 clone 还是 init
   * 2. 确保 remote origin（补设或更新）
   * 3. 确保 git config 有 user.name/email（容器内没有全局配置）
   * 4. 确保 main 分支存在（空仓库需要先创建 initial commit）
   * 5. 确保当月 workspace/YYYY-MM 分支存在并 checkout
   *    - 旧月分支有 commit → 归档到 main
   *    - 旧月分支无 commit → 直接删除
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.ensureRepo();
      await this.ensureRemote();
      await this.ensureGitConfig();
      await this.ensureMainBranch();
      await this.ensureWorkspaceBranchReady();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Git init failed: ${msg}`);
      this.kbGitSummaryLine = `KB Git: FAILED — ${msg}`;
      return;
    }

    const branch = await this.tryRun(() =>
      this.git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    );
    const remote = await this.tryRun(() =>
      this.git.raw(['remote', 'get-url', 'origin']),
    );
    const remoteSafe = remote?.trim()
      ? redactKbRemoteUrlForLog(remote.trim())
      : 'none';
    const commitCount = await this.tryRun(() =>
      this.git.raw(['rev-list', '--count', 'HEAD']),
    );

    this.kbGitSummaryLine = `KB Git: OK — branch: ${branch?.trim() ?? '?'}, commits: ${commitCount?.trim() ?? '?'}, remote: ${remoteSafe}`;
  }

  /** Step 1: 仓库不存在则 git init（不自动 clone，clone 只在用户触发恢复时） */
  private async ensureRepo(): Promise<void> {
    if (existsSync(join(this.repoRoot, '.git'))) return;

    await mkdir(this.repoRoot, { recursive: true });
    this.logger.log('Initializing empty knowledge-base repo');
    await this.git.init();
  }

  /** Step 2: 补设或更新 remote origin */
  private async ensureRemote(): Promise<void> {
    const remoteUrl = resolveKbRemoteUrlForGit();
    if (!remoteUrl) return;

    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    if (!origin) {
      await this.git.addRemote('origin', remoteUrl);
      this.logger.log(
        `Added remote origin: ${redactKbRemoteUrlForLog(remoteUrl)}`,
      );
    } else if (origin.refs.fetch !== remoteUrl) {
      await this.git.remote(['set-url', 'origin', remoteUrl]);
      this.logger.log(
        `Updated remote origin: ${redactKbRemoteUrlForLog(remoteUrl)}`,
      );
    }
  }

  /** Step 3: 容器内没有全局 git config，设到 repo 级别 */
  private async ensureGitConfig(): Promise<void> {
    await this.git.addConfig(
      'user.name',
      this.resolveAuthorName(),
      false,
      'local',
    );
    await this.git.addConfig(
      'user.email',
      this.resolveAuthorEmail(),
      false,
      'local',
    );
  }

  private resolveRepositoryRoot(): string {
    return this.repoRoot;
  }

  private resolveTrackedContentPath(contentId: string): string | null {
    const contentDirectory =
      this.contentRepoService.getContentDirectoryPath(contentId);
    const trackedPath = relative(this.repoRoot, contentDirectory);

    if (
      !trackedPath ||
      trackedPath.startsWith('..') ||
      isAbsolute(trackedPath)
    ) {
      return null;
    }

    return trackedPath.replace(/\\/g, '/');
  }

  private buildCommitMessage(_contentId: string, changeNote: string): string {
    const note = changeNote.replace(/\s+/g, ' ').trim() || '提交';
    return note.length > 72 ? `${note.slice(0, 69).trimEnd()}...` : note;
  }

  /** 按当前月份生成工作分支名，格式 workspace/YYYY-MM */
  private resolveWorkBranch(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `workspace/${year}-${month}`;
  }

  private resolveAuthorName(): string {
    return (
      process.env.CONTENT_GIT_AUTHOR_NAME?.trim() ||
      ContentGitService.defaultAuthorName
    );
  }

  private resolveAuthorEmail(): string {
    return (
      process.env.CONTENT_GIT_AUTHOR_EMAIL?.trim() ||
      ContentGitService.defaultAuthorEmail
    );
  }

  /** 执行 git 命令，失败时抛出；返回值已 trim */
  private async run(fn: () => Promise<string>): Promise<string> {
    return (await fn()).trim();
  }

  /** 执行 git 命令，失败时返回 null（用于诊断场景，不中断流程） */
  private async tryRun(fn: () => Promise<string>): Promise<string | null> {
    try {
      return (await fn()).trim();
    } catch (err: unknown) {
      // debug 级别：tryRun 本身设计为"失败可忽略"，但记录有助于诊断 git 环境问题
      this.logger.debug(
        `tryRun: git 命令失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** Step 4: 确保 main 分支存在（空仓库需先创建 initial commit） */
  private async ensureMainBranch(): Promise<void> {
    const branches = await this.git.branchLocal();
    if (branches.all.includes('main')) return;

    // 空仓库没有任何 commit → 先创建一个（git config 已在 step 3 设好）
    if (branches.all.length === 0) {
      await this.git.raw([
        'commit',
        '--allow-empty',
        '-m',
        'init: empty knowledge base',
      ]);
      this.logger.log('Created initial empty commit');
    }

    // commit 可能落在默认分支 main 上（git init 的默认），再检查一次
    const updated = await this.git.branchLocal();
    if (!updated.all.includes('main')) {
      await this.git.branch(['main']);
    }
    this.logger.log('Main branch ready');
  }

  /**
   * 月度归档：将旧月分支 merge 回 main 并 push。
   */
  private async archiveMonthBranch(branch: string): Promise<void> {
    this.logger.log(`Archiving ${branch} → main`);
    await this.git.checkout('main');
    await this.git.raw([
      'merge',
      branch,
      '--no-edit',
      '--allow-unrelated-histories',
      '-m',
      `archive: merge ${branch} into main`,
    ]);
    if (!this.isSyncEnabled()) {
      this.logger.debug('Sync disabled, skipping push after archive');
    } else if (await this.hasOriginRemote()) {
      const pushResult = await this.tryRun(() =>
        this.git.raw(['push', 'origin', 'main']),
      );
      if (pushResult === null) {
        this.logger.warn('Failed to push main to origin after archive');
      }
    } else {
      this.logger.debug('No origin remote, skipping push after archive');
    }
    this.logger.log(`Archived ${branch} to main`);
  }

  /** Step 5: 确保当月工作分支存在并 checkout，旧月分支归档 */
  private async ensureWorkspaceBranchReady(): Promise<void> {
    const targetBranch = this.resolveWorkBranch();
    const branches = await this.git.branchLocal();

    // 已在目标分支
    if (branches.current === targetBranch) return;

    // 旧月分支需要归档到 main
    if (
      branches.current.startsWith('workspace/') &&
      branches.current !== targetBranch
    ) {
      const hasCommits = await this.tryRun(() =>
        this.git.raw(['log', '--oneline', '-1', branches.current]),
      );
      if (hasCommits) {
        await this.archiveMonthBranch(branches.current);
      } else {
        await this.git.checkout('main');
        await this.git.deleteLocalBranch(branches.current, true);
        this.logger.log(`Deleted empty branch ${branches.current}`);
      }
    }

    // 切到或创建目标分支
    const updated = await this.git.branchLocal();
    if (updated.all.includes(targetBranch)) {
      await this.git.checkout(targetBranch);
    } else {
      await this.git.checkout(['-b', targetBranch, 'main']);
      this.logger.log(`Created monthly branch ${targetBranch}`);
    }
  }

  /** 运行时确保工作分支就绪（处理跨月切换） */
  async prepareWritableWorkspace(): Promise<void> {
    await this.ensureWorkspaceBranchReady();
  }

  async recordCommittedContentChange(
    contentId: string,
    changeNote: string,
  ): Promise<string | null> {
    // add → diff → commit 三步必须在同一个锁内完成，
    // 否则并发请求会交叉污染 staged 区域，导致一方提交了另一方的文件
    return this.writeLock.runExclusive(async () => {
      await this.prepareWritableWorkspace();

      const trackedPath = this.resolveTrackedContentPath(contentId);
      if (!trackedPath) {
        return null;
      }

      await this.run(() => this.git.add(['--', trackedPath]));

      const stagedFiles = await this.run(() =>
        this.git.raw(['diff', '--cached', '--name-only', '--', trackedPath]),
      );

      if (!stagedFiles) {
        return null;
      }

      await this.git
        .env({
          GIT_AUTHOR_NAME: this.resolveAuthorName(),
          GIT_AUTHOR_EMAIL: this.resolveAuthorEmail(),
          GIT_COMMITTER_NAME: this.resolveAuthorName(),
          GIT_COMMITTER_EMAIL: this.resolveAuthorEmail(),
        })
        .raw([
          'commit',
          '-m',
          this.buildCommitMessage(contentId, changeNote),
          '--',
          trackedPath,
        ]);

      return this.run(() => this.git.revparse(['HEAD']));
    });
  }

  /**
   * 批量导入专用：在一次 writeLock 内 stage 多个 content 目录并做单次 commit。
   * 避免 N 个文件 N 次 lock 的性能问题。
   */
  async recordBatchCommit(
    contentIds: string[],
    note: string,
  ): Promise<string | null> {
    return this.writeLock.runExclusive(async () => {
      await this.prepareWritableWorkspace();

      // Stage all content directories
      for (const contentId of contentIds) {
        const trackedPath = this.resolveTrackedContentPath(contentId);
        if (trackedPath) {
          await this.run(() => this.git.add(['--', trackedPath]));
        }
      }

      // Check if anything was staged
      const stagedFiles = await this.run(() =>
        this.git.raw(['diff', '--cached', '--name-only']),
      );
      if (!stagedFiles) return null;

      const commitMsg =
        note.length > 48 ? `${note.slice(0, 45).trimEnd()}...` : note;

      await this.git
        .env({
          GIT_AUTHOR_NAME: this.resolveAuthorName(),
          GIT_AUTHOR_EMAIL: this.resolveAuthorEmail(),
          GIT_COMMITTER_NAME: this.resolveAuthorName(),
          GIT_COMMITTER_EMAIL: this.resolveAuthorEmail(),
        })
        .raw(['commit', '-m', commitMsg]);

      return this.run(() => this.git.revparse(['HEAD']));
    });
  }

  /**
   * 查询同步状态。
   *
   * 关键：先检查 repoRoot/.git 是否存在，不存在不跑任何 git 命令
   * （防止 git 往上级目录查找到应用代码仓库）。
   * 远端状态用 ls-remote（轻量，不下载对象）。
   *
   * syncState 取值：
   * - 'no_repo'：本地仓库不存在
   * - 'no_remote'：未配置远端
   * - 'remote_empty'：远端为空，可推送
   * - 'synced'：已同步
   * - 'ahead'：本地领先，有待推送
   * - 'diverged'：历史不一致，只能恢复
   * - 'behind'：远端领先，可恢复
   */
  async getSyncStatus(): Promise<{
    branch: string;
    totalCommits: number;
    unpushedCommits: number;
    syncState:
      | 'no_repo'
      | 'no_remote'
      | 'remote_empty'
      | 'synced'
      | 'ahead'
      | 'diverged'
      | 'behind';
    lastCommitMessage: string;
    lastCommitTime: string;
  } | null> {
    // 先检查 .git 是否存在，不存在则本地无仓库
    if (!existsSync(join(this.repoRoot, '.git'))) {
      // 即使没有本地仓库，也尝试检查远端（用 SystemConfig 里的 URL）
      const remoteUrl = resolveKbRemoteUrlForGit();
      if (!remoteUrl) {
        return {
          branch: '',
          totalCommits: 0,
          unpushedCommits: 0,
          syncState: 'no_repo',
          lastCommitMessage: '',
          lastCommitTime: '',
        };
      }
      // 检查远端是否有数据
      try {
        const refs = await simpleGit().listRemote([remoteUrl]);
        return {
          branch: '',
          totalCommits: 0,
          unpushedCommits: 0,
          syncState: refs.trim() ? 'behind' : 'no_repo',
          lastCommitMessage: '',
          lastCommitTime: '',
        };
      } catch {
        return {
          branch: '',
          totalCommits: 0,
          unpushedCommits: 0,
          syncState: 'no_repo',
          lastCommitMessage: '',
          lastCommitTime: '',
        };
      }
    }

    // 本地仓库存在，读取基本信息
    const branch = await this.tryRun(() =>
      this.git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    );
    if (!branch) return null;

    const totalCommits = await this.tryRun(() =>
      this.git.raw(['rev-list', '--count', 'HEAD']),
    );
    const lastLog = await this.tryRun(() =>
      this.git.raw(['log', '-1', '--format=%s%x1f%aI']),
    );
    const [lastCommitMessage, lastCommitTime] = lastLog?.split('\x1f') ?? [
      '',
      '',
    ];
    const base = {
      branch,
      totalCommits: parseInt(totalCommits ?? '0', 10),
      lastCommitMessage: lastCommitMessage || '',
      lastCommitTime: lastCommitTime || '',
    };

    // 检查远端配置——git 仓库没有 origin 时尝试从 env/config 补设
    if (!(await this.hasOriginRemote())) {
      const configUrl = resolveKbRemoteUrlForGit();
      if (!configUrl) {
        return { ...base, unpushedCommits: 0, syncState: 'no_remote' };
      }
      // 补设 origin（启动顺序导致初始化时可能漏设）
      await this.tryRun(() =>
        this.git.raw(['remote', 'add', 'origin', configUrl]),
      );
      this.logger.log('Auto-added origin remote from config');
    }

    // ls-remote 轻量获取远端 ref
    const remoteUrl = await this.tryRun(() =>
      this.git.raw(['remote', 'get-url', 'origin']),
    );
    if (!remoteUrl) {
      return { ...base, unpushedCommits: 0, syncState: 'no_remote' };
    }

    let remoteRefs: string;
    try {
      remoteRefs = await this.git.raw(['ls-remote', '--heads', remoteUrl]);
    } catch {
      return { ...base, unpushedCommits: 0, syncState: 'no_remote' };
    }

    if (!remoteRefs.trim()) {
      return {
        ...base,
        unpushedCommits: base.totalCommits,
        syncState: 'remote_empty',
      };
    }

    // 解析远端 refs
    const remoteRefMap = new Map<string, string>();
    for (const line of remoteRefs.trim().split('\n')) {
      const [hash, ref] = line.split('\t');
      if (hash && ref) {
        remoteRefMap.set(ref.replace('refs/heads/', ''), hash);
      }
    }

    // 匹配远端分支
    const remoteKeys = [...remoteRefMap.keys()];
    const matchedBranch =
      remoteKeys.find((r) => r === branch) ??
      remoteKeys
        .filter((r) => r.startsWith('workspace/'))
        .sort()
        .pop() ??
      remoteKeys.find((r) => r === 'main');

    if (!matchedBranch) {
      return {
        ...base,
        unpushedCommits: base.totalCommits,
        syncState: 'remote_empty',
      };
    }

    const remoteHash = remoteRefMap.get(matchedBranch)!;
    const localHash = await this.tryRun(() => this.git.revparse(['HEAD']));

    if (localHash === remoteHash) {
      return { ...base, unpushedCommits: 0, syncState: 'synced' };
    }

    // 检查祖先关系判断 ahead/behind/diverged
    const isAncestor = await this.tryRun(() =>
      this.git.raw(['merge-base', '--is-ancestor', remoteHash, 'HEAD']),
    );
    if (isAncestor !== null) {
      const aheadCount = await this.tryRun(() =>
        this.git.raw(['rev-list', '--count', `${remoteHash}..HEAD`]),
      );
      return {
        ...base,
        unpushedCommits: parseInt(aheadCount ?? '0', 10),
        syncState: 'ahead',
      };
    }

    const isBehind = await this.tryRun(() =>
      this.git.raw(['merge-base', '--is-ancestor', 'HEAD', remoteHash]),
    );
    if (isBehind !== null) {
      return { ...base, unpushedCommits: 0, syncState: 'behind' };
    }

    return { ...base, unpushedCommits: 0, syncState: 'diverged' };
  }

  /**
   * 若 .liminal-field.yaml 有未提交的变更，将其 stage 并提交一个专属 commit。
   * 设计为幂等：文件无变更时 diff --cached 为空，直接返回，不产生空 commit。
   * 由 AuthController.syncToRemote 在推送前调用，确保清单随本次 push 入远程。
   */
  async commitManifestIfChanged(): Promise<void> {
    return this.writeLock.runExclusive(async () => {
      const manifestFile = '.liminal-field.yaml';
      await this.run(() => this.git.add(['--', manifestFile]));

      const staged = await this.run(() =>
        this.git.raw(['diff', '--cached', '--name-only', '--', manifestFile]),
      );

      if (!staged) return; // 无变更，跳过

      await this.git
        .env({
          GIT_AUTHOR_NAME: this.resolveAuthorName(),
          GIT_AUTHOR_EMAIL: this.resolveAuthorEmail(),
          GIT_COMMITTER_NAME: this.resolveAuthorName(),
          GIT_COMMITTER_EMAIL: this.resolveAuthorEmail(),
        })
        .raw(['commit', '-m', '更新清单', '--', manifestFile]);

      this.logger.log('Manifest commit created');
    });
  }

  /** 检查 origin remote 是否配置 */
  private async hasOriginRemote(): Promise<boolean> {
    return !!(await this.getOriginUrl());
  }

  /** 获取 origin remote URL，未配置时返回 undefined */
  private async getOriginUrl(): Promise<string | undefined> {
    const url = await this.tryRun(() =>
      this.git.raw(['remote', 'get-url', 'origin']),
    );
    return url?.trim() || undefined;
  }

  /**
   * 检查远端仓库是否为空（无任何 ref）。
   * 用于 push-to-remote 前置校验：只允许向空仓库推送。
   */
  async isRemoteEmpty(): Promise<boolean> {
    if (!(await this.hasOriginRemote())) return true;
    try {
      const remoteUrl = await this.run(() =>
        this.git.raw(['remote', 'get-url', 'origin']),
      );
      const refs = await this.git.listRemote([remoteUrl]);
      return !refs.trim();
    } catch {
      // ls-remote 失败（网络/认证问题）视为非空，阻止推送
      return false;
    }
  }

  /**
   * 检查远端是否可连通。
   * 纯连通性检测，不修改本地状态。
   */
  async isRemoteConnected(): Promise<boolean> {
    if (!(await this.hasOriginRemote())) return false;
    try {
      const remoteUrl = await this.run(() =>
        this.git.raw(['remote', 'get-url', 'origin']),
      );
      await this.git.listRemote([remoteUrl]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清空后重建空仓库（不从远端 clone，只 git init）。
   * 用户想要远端数据应该手动点"恢复"。
   */
  async reinitRepo(): Promise<void> {
    await mkdir(this.repoRoot, { recursive: true });
    // 只 git init，不 clone
    const freshGit = simpleGit(this.repoRoot);
    await freshGit.init();
    await this.ensureRemote();
    await this.ensureGitConfig();
    await this.ensureMainBranch();
    await this.ensureWorkspaceBranchReady();
    // 重建 git 实例，确保指向新的 .git
    this.git = simpleGit(this.repoRoot);
    this.logger.log('Repo reinitialized (empty)');
  }

  /** 同步开关:关闭(GIT_SYNC_ENABLED==='false')时一律不向远端 push(自动 cron / 月度归档 / 手动推送都走这里被拦) */
  private isSyncEnabled(): boolean {
    return process.env.GIT_SYNC_ENABLED !== 'false';
  }

  /** 推送指定分支到远端（不切换 HEAD） */
  async pushBranch(
    branch: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isSyncEnabled()) {
      return { success: true, message: '同步已关闭，跳过推送' };
    }
    if (!(await this.hasOriginRemote())) {
      return { success: true, message: '未配置远程仓库，跳过' };
    }
    try {
      await this.git.push('origin', branch);
      this.logger.log(`Pushed ${branch} to origin`);
      return { success: true, message: `已推送 ${branch}` };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Push ${branch} failed: ${msg}`);
      return { success: false, message: msg };
    }
  }

  /**
   * Push 当前工作分支到远程。
   * 纯基础设施操作——只推送已 commit 的内容，不做 add/commit。
   * 无 remote 时静默跳过，避免日志噪音。
   */
  async pushCurrentBranch(): Promise<{ success: boolean; message: string }> {
    if (!this.isSyncEnabled()) {
      this.logger.debug('Sync disabled, skipping push');
      return { success: true, message: '同步已关闭，跳过推送' };
    }
    if (!(await this.hasOriginRemote())) {
      this.logger.debug('No origin remote configured, skipping push');
      return { success: true, message: '未配置远程仓库，跳过推送' };
    }

    const currentBranch = await this.tryRun(() =>
      this.git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    );
    if (!currentBranch) {
      return { success: false, message: 'Cannot determine current branch' };
    }

    try {
      await this.git.push('origin', currentBranch);
      this.logger.log(`Pushed ${currentBranch} to origin`);
      return { success: true, message: `已同步 ${currentBranch} 到远程` };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to push ${currentBranch}: ${msg}`);
      return { success: false, message: `同步失败: ${msg}` };
    }
  }

  /**
   * 从远端恢复：清空仓库目录内容 → 全新 clone → 重建 workspace。
   * 目录本身是 Docker volume 挂载点不能删，但内容可以清空后重新 clone。
   */
  async pullFromRemote(): Promise<{ success: boolean; message: string }> {
    return this.writeLock.runExclusive(async () => {
      // 优先从 git remote 取 URL（saveSyncConfig 已同步），env 作 fallback
      let remoteUrl = await this.getOriginUrl();
      if (!remoteUrl) remoteUrl = resolveKbRemoteUrlForGit() ?? undefined;
      if (!remoteUrl) {
        return { success: false, message: '未配置远程仓库' };
      }

      try {
        // 1. 清空目录内容（保留挂载点）
        const entries = await readdir(this.repoRoot);
        for (const entry of entries) {
          await rm(join(this.repoRoot, entry), {
            recursive: true,
            force: true,
          });
        }
        this.logger.log('Cleared repo directory');

        // 2. 直接 clone 到已清空的目录（不用 temp，避免跨文件系统 rename 失败）
        await simpleGit().clone(remoteUrl, this.repoRoot);
        this.logger.log('Cloned from remote');

        // 3. 重新指向新仓库
        const freshGit = simpleGit(this.repoRoot);
        await freshGit.addConfig(
          'user.name',
          this.resolveAuthorName(),
          false,
          'local',
        );
        await freshGit.addConfig(
          'user.email',
          this.resolveAuthorEmail(),
          false,
          'local',
        );

        // 4. 确保 main 存在
        const branches = await freshGit.branchLocal();
        if (!branches.all.includes('main')) {
          const remotes = await freshGit.branch(['-r']);
          if (remotes.all.includes('origin/main')) {
            await freshGit.branch(['main', 'origin/main']);
          }
        }

        // 5. 切到当月 workspace
        const targetBranch = this.resolveWorkBranch();
        const updated = await freshGit.branchLocal();
        if (updated.all.includes(targetBranch)) {
          if (updated.current !== targetBranch) {
            await freshGit.checkout(targetBranch);
          }
        } else {
          // 选恢复源:优先当月 workspace;否则取 origin 上【最近的 workspace 分支】
          // (按名字字典序=YYYY-MM 时间序,最新月在前);都没有才用 main。
          // 关键修复:旧逻辑直接 fallback 到 main——但本月推送、未跨月归档时 main 是空的,
          // 隔月恢复会丢光内容。改为落到最近月的 workspace 分支(它必含最新内容)。
          const allRemote = await freshGit.branch(['-r']);
          const remoteTarget = `origin/${targetBranch}`;
          const latestRemoteWorkspace = allRemote.all
            .filter((b) => b.startsWith('origin/workspace/'))
            .sort()
            .reverse()[0];
          const sourceRef = allRemote.all.includes(remoteTarget)
            ? remoteTarget
            : (latestRemoteWorkspace ?? 'main');
          await freshGit.checkout(['-b', targetBranch, sourceRef]);
          this.logger.log(
            `Restore source branch: ${sourceRef} → ${targetBranch}`,
          );
        }

        // 重建 git 实例，确保指向 clone 后的新 .git
        this.git = simpleGit(this.repoRoot);
        this.logger.log(`Pull complete, on branch ${targetBranch}`);
        return { success: true, message: '已从远端拉取数据' };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Pull from remote failed: ${msg}`);
        return { success: false, message: `拉取失败: ${msg}` };
      }
    });
  }

  /**
   * 定时扫描 commitHash 未回填的 snapshot，重试 Git 归档。
   * 每 5 分钟执行一次，每次最多处理 20 条，串行避免 writeLock 争抢。
   * cron 表达式通过 GIT_ARCHIVE_RETRY_CRON 环境变量配置。
   *
   * 注意：recordCommittedContentChange 内部已持有 writeLock，
   * 此方法不能在锁内调用它，串行逐条处理即可。
   */
  @Cron(process.env.GIT_ARCHIVE_RETRY_CRON?.trim() || '*/5 * * * *')
  async retryPendingArchives(): Promise<void> {
    if (this.writeLock.isLocked()) return;

    const pending = await this.snapshotRepository.findPendingArchive(20);
    if (pending.length === 0) return;

    this.logger.log(`Archive retry: ${pending.length} pending snapshots`);

    for (const snapshot of pending) {
      try {
        const contentId = snapshot.contentItemId;
        const content = await this.contentRepository.findById(contentId);
        if (!content) {
          this.logger.warn(
            `Archive retry: content ${contentId} not found, skipping`,
          );
          continue;
        }

        // 写磁盘前清洗脏 URL：OSS 签名 URL / draft-assets 代理 URL → ./assets/ 相对路径
        const cleanMarkdown = snapshot.bodyMarkdown
          .replace(
            new RegExp(
              `https?://[^/]+/assets/${contentId}/([^?)\\s"]+)[^)\\s"]*`,
              'g',
            ),
            (_m, f) => `./assets/${f}`,
          )
          .replace(
            new RegExp(
              `/api/v1/spaces/[^/]+/items/${contentId}/(?:draft-)?assets/([^?)\\s"]+)[^)\\s"]*`,
              'g',
            ),
            (_m, f) => `./assets/${f}`,
          );

        // 根据 snapshot.fileName 决定写入路径：null → main.md，非 null → 子文件
        if (snapshot.fileName) {
          await this.contentRepoService.writeFileMarkdown(
            contentId,
            snapshot.fileName,
            cleanMarkdown,
          );
        } else {
          await this.contentRepoService.writeMainMarkdown(
            contentId,
            cleanMarkdown,
          );
        }

        // Git commit（内部持有 writeLock，串行调用安全）
        const commitHash = await this.recordCommittedContentChange(
          contentId,
          snapshot.changeNote || 'archive retry',
        );

        // commitHash 为 null 表示无变更（文件已归档过），直接跳过
        if (!commitHash) {
          this.logger.debug(
            `Archive retry: ${contentId} no diff, already archived`,
          );
          continue;
        }

        // 回填 snapshot.commitHash
        await this.snapshotRepository.backfillCommitHash(
          snapshot.versionId,
          commitHash,
        );

        // 回填 ContentItem 的 latestVersion.commitHash 和 changeLogs[0]
        // 使用 JSON 序列化避免 Mongoose 子文档 spread 丢失字段
        const latestVersion = content.latestVersion;
        const publishedVersion = content.publishedVersion;

        const updatedChangeLogs = content.changeLogs.map((log, index) => {
          // 最新 changeLog（index 0）尚无 commitHash，对应本次 Git commit
          if (index === 0 && !log.commitHash) {
            return { ...log, commitHash };
          }
          return log;
        });

        const latestPlain =
          latestVersion && latestVersion.versionId === snapshot.versionId
            ? (JSON.parse(JSON.stringify(latestVersion)) as Record<
                string,
                unknown
              >)
            : null;

        const publishedPlain =
          publishedVersion?.versionId === snapshot.versionId
            ? (JSON.parse(JSON.stringify(publishedVersion)) as Record<
                string,
                unknown
              >)
            : null;

        await this.contentRepository.update(contentId, {
          latestVersion: latestPlain
            ? ({ ...latestPlain, commitHash } as ContentVersion)
            : (latestVersion ?? { title: '', commitHash: '' }),
          publishedVersion: publishedPlain
            ? ({ ...publishedPlain, commitHash } as ContentVersion)
            : (publishedVersion ?? null),
          changeLogs: updatedChangeLogs,
          updatedAt: content.updatedAt,
        });

        this.logger.log(
          `Archive retry: ${contentId} → ${commitHash.slice(0, 8)}`,
        );
      } catch (err: unknown) {
        this.logger.warn(
          `Archive retry failed for ${snapshot.contentItemId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** 定时自动 push + 检查月度切换。cron 表达式通过 GIT_SYNC_CRON 环境变量配置，默认每天凌晨 3 点。 */
  @Cron(process.env.GIT_SYNC_CRON?.trim() || '0 3 * * *')
  async scheduledSync(): Promise<void> {
    if (this.writeLock.isLocked()) {
      this.logger.log('Scheduled sync skipped: write operation in progress');
      return;
    }
    return this.writeLock.runExclusive(async () => {
      this.logger.log('Scheduled sync: checking branch and pushing...');
      await this.prepareWritableWorkspace();
      const result = await this.pushCurrentBranch();
      this.logger.log(`Scheduled sync result: ${result.message}`);
    });
  }

  // 注:这是基于 git log 的提交历史(commitHash/作者/message),与 V2 的
  // ContentHistoryEntryDto(versionId/changeType)语义不同,故返回独立形状。
  async listContentHistory(contentId: string): Promise<
    Array<{
      commitHash: string;
      committedAt: string;
      authorName: string;
      authorEmail: string;
      message: string;
      action: 'commit';
    }>
  > {
    const trackedPath = this.resolveTrackedContentPath(contentId);
    if (!trackedPath) {
      return [];
    }

    // 读操作不需要 prepareWritableWorkspace——历史 hash 从当前 HEAD 全部可达，
    // 调它只会白跑多个 git 命令确认分支状态，对读取毫无意义
    const rawHistory = await this.tryRun(() =>
      this.git.raw([
        'log',
        '--format=%H%x1f%aI%x1f%an%x1f%ae%x1f%s',
        '--',
        trackedPath,
      ]),
    );

    if (!rawHistory) {
      return [];
    }

    // git log --<path> 已按文件路径过滤，不再按 message 前缀二次过滤
    return rawHistory
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\x1f');
        return {
          commitHash: parts[0] ?? '',
          committedAt: parts[1] ?? '',
          authorName: parts[2] ?? '',
          authorEmail: parts[3] ?? '',
          message: parts[4] ?? '',
          action: 'commit' as const,
        };
      });
  }
}
