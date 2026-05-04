import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Mutex } from 'async-mutex';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import { isAbsolute, join, relative } from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { ContentRepoService } from './content-repo.service';
import { ContentHistoryEntryDto } from './dto/content-history.dto';

@Injectable()
export class ContentGitService implements OnModuleInit {
  private readonly logger = new Logger(ContentGitService.name);

  private static readonly defaultAuthorName = 'Liminal Field';
  private static readonly defaultAuthorEmail = 'no-reply@liminal-field.local';

  private readonly repoRoot: string;
  private readonly git: SimpleGit;
  /** Git 写操作互斥锁：add → diff → commit 必须原子化，防止并发请求交叉污染 staged 区域 */
  private readonly writeLock = new Mutex();

  constructor(
    private readonly contentRepoService: ContentRepoService,
    private readonly configService: ConfigService,
  ) {
    this.repoRoot = this.configService.getOrThrow<string>('content.repoRoot');
    this.git = simpleGit(this.repoRoot);
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
    } catch (error: any) {
      this.logger.error(`Git init failed: ${error.message}`);
      return;
    }

    const branch = await this.tryRun(() =>
      this.git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    );
    const remote = await this.tryRun(() =>
      this.git.raw(['remote', 'get-url', 'origin']),
    );
    const commitCount = await this.tryRun(() =>
      this.git.raw(['rev-list', '--count', 'HEAD']),
    );

    this.logger.log(
      `Git storage ready — branch: ${branch}, commits: ${commitCount?.trim() ?? '?'}, remote: ${remote?.trim() ?? 'none'}`,
    );
  }

  /** Step 1: 获取或创建仓库 */
  private async ensureRepo(): Promise<void> {
    if (existsSync(join(this.repoRoot, '.git'))) return;

    const remoteUrl = process.env.KB_REMOTE_URL?.trim();
    await mkdir(this.repoRoot, { recursive: true });

    if (remoteUrl) {
      this.logger.log(`Cloning knowledge-base from ${remoteUrl}`);
      await simpleGit().clone(remoteUrl, this.repoRoot);
    } else {
      this.logger.log('Initializing empty knowledge-base repo (no KB_REMOTE_URL)');
      await this.git.init();
    }
  }

  /** Step 2: 补设或更新 remote origin */
  private async ensureRemote(): Promise<void> {
    const remoteUrl = process.env.KB_REMOTE_URL?.trim();
    if (!remoteUrl) return;

    const remotes = await this.git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    if (!origin) {
      await this.git.addRemote('origin', remoteUrl);
      this.logger.log(`Added remote origin: ${remoteUrl}`);
    } else if (origin.refs.fetch !== remoteUrl) {
      await this.git.remote(['set-url', 'origin', remoteUrl]);
      this.logger.log(`Updated remote origin: ${remoteUrl}`);
    }
  }

  /** Step 3: 容器内没有全局 git config，设到 repo 级别 */
  private async ensureGitConfig(): Promise<void> {
    await this.git.addConfig('user.name', this.resolveAuthorName(), false, 'local');
    await this.git.addConfig('user.email', this.resolveAuthorEmail(), false, 'local');
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

  private buildCommitMessage(contentId: string, changeNote: string): string {
    const normalizedNote = changeNote.replace(/\s+/g, ' ').trim() || 'commit';
    const summary =
      normalizedNote.length > 48
        ? `${normalizedNote.slice(0, 45).trimEnd()}...`
        : normalizedNote;

    return `content(${contentId}): commit | ${summary}`;
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

  private detectHistoryAction(
    contentId: string,
    message: string,
  ): ContentHistoryEntryDto['action'] {
    if (!message.startsWith(`content(${contentId}):`)) {
      return 'unknown';
    }

    return 'commit';
  }

  /** 执行 git 命令，失败时抛出；返回值已 trim */
  private async run(fn: () => Promise<string>): Promise<string> {
    return (await fn()).trim();
  }

  /** 执行 git 命令，失败时返回 null */
  private async tryRun(fn: () => Promise<string>): Promise<string | null> {
    try {
      return (await fn()).trim();
    } catch {
      return null;
    }
  }

  /** Step 4: 确保 main 分支存在（空仓库需先创建 initial commit） */
  private async ensureMainBranch(): Promise<void> {
    const branches = await this.git.branchLocal();
    if (branches.all.includes('main')) return;

    // 空仓库没有任何 commit → 先创建一个（git config 已在 step 3 设好）
    if (branches.all.length === 0) {
      await this.git.raw(['commit', '--allow-empty', '-m', 'init: empty knowledge base']);
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
    await this.git.merge([
      branch,
      '--no-edit',
      '-m',
      `archive: merge ${branch} into main`,
    ]);
    const pushResult = await this.tryRun(() =>
      this.git.raw(['push', 'origin', 'main']),
    );
    if (pushResult === null) {
      this.logger.warn('Failed to push main to origin after archive');
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
    if (branches.current.startsWith('workspace/') && branches.current !== targetBranch) {
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

  /** 查询当前仓库同步状态，供前端弹窗展示 */
  async getSyncStatus(): Promise<{
    branch: string;
    totalCommits: number;
    unpushedCommits: number;
    lastCommitMessage: string;
    lastCommitTime: string;
    remote: string;
  } | null> {
    const branch = await this.tryRun(() =>
      this.git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    );
    if (!branch) return null;

    const totalCommits = await this.tryRun(() =>
      this.git.raw(['rev-list', '--count', 'HEAD']),
    );

    const unpushed = await this.tryRun(() =>
      this.git.raw(['rev-list', '--count', `origin/${branch}..HEAD`]),
    );

    const lastLog = await this.tryRun(() =>
      this.git.raw(['log', '-1', '--format=%s%x1f%aI']),
    );
    const [lastCommitMessage, lastCommitTime] =
      lastLog?.split('\x1f') ?? ['', ''];

    const remote = await this.tryRun(() =>
      this.git.raw(['remote', 'get-url', 'origin']),
    );

    return {
      branch,
      totalCommits: parseInt(totalCommits ?? '0', 10),
      unpushedCommits: parseInt(unpushed ?? '0', 10),
      lastCommitMessage: lastCommitMessage || '',
      lastCommitTime: lastCommitTime || '',
      remote: remote ?? '',
    };
  }

  /**
   * Push 当前工作分支到远程。
   * 纯基础设施操作——只推送已 commit 的内容，不做 add/commit。
   */
  async pushCurrentBranch(): Promise<{ success: boolean; message: string }> {
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
    } catch (error: any) {
      this.logger.error(`Failed to push ${currentBranch}: ${error.message}`);
      return { success: false, message: `同步失败: ${error.message}` };
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

  async listContentHistory(
    contentId: string,
  ): Promise<ContentHistoryEntryDto[]> {
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

    // 只保留属于该 content 的正式 commit（message 以 "content(ci_xxx):" 开头），
    // 过滤掉维护性 commit（如 README 清理、批量修复等不影响内容的杂项 commit）
    const contentPrefix = `content(${contentId}):`;
    return rawHistory
      .split('\n')
      .filter(Boolean)
      .map((entry) => {
        const [commitHash, committedAt, authorName, authorEmail, message] =
          entry.split('\x1f');

        return {
          commitHash,
          committedAt,
          authorName,
          authorEmail,
          message,
          action: this.detectHistoryAction(contentId, message),
        };
      })
      .filter((entry) => entry.message.startsWith(contentPrefix));
  }
}
