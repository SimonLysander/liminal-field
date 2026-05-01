import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { isAbsolute, relative } from 'path';
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

  constructor(
    private readonly contentRepoService: ContentRepoService,
    private readonly configService: ConfigService,
  ) {
    this.repoRoot = this.configService.getOrThrow<string>('content.repoRoot');
    this.git = simpleGit(this.repoRoot);
  }

  /** 启动时初始化工作分支并打印存储层状态 */
  async onModuleInit(): Promise<void> {
    try {
      await this.prepareWritableWorkspace();
    } catch (error: any) {
      this.logger.error(`Git workspace init failed: ${error.message}`);
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

  /**
   * 确保 main 分支存在。
   * 首次从 workspace/local 升级时，从当前 HEAD 创建 main。
   */
  private async ensureMainBranch(): Promise<void> {
    const mainExists = await this.tryRun(() =>
      this.git.raw(['show-ref', '--verify', '--quiet', 'refs/heads/main']),
    );
    if (mainExists !== null) return;

    const currentBranch = await this.tryRun(() =>
      this.git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    );
    await this.git.branch(['main']);
    this.logger.log(`Created main branch from ${currentBranch ?? 'HEAD'}`);
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

  private async ensureWorkspaceBranchReady(): Promise<string> {
    const targetBranch = this.resolveWorkBranch();
    const currentBranch = await this.tryRun(() =>
      this.git.raw(['symbolic-ref', '--quiet', '--short', 'HEAD']),
    );

    if (currentBranch === targetBranch) {
      return targetBranch;
    }

    await this.ensureMainBranch();

    if (
      currentBranch &&
      currentBranch.startsWith('workspace/') &&
      currentBranch !== targetBranch
    ) {
      await this.archiveMonthBranch(currentBranch);
    }

    const status = await this.git.status();
    if (!status.isClean()) {
      throw new ConflictException(
        'Knowledge-base repository has uncommitted changes; refusing to switch branch',
      );
    }

    const branchExists = await this.tryRun(() =>
      this.git.raw([
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${targetBranch}`,
      ]),
    );

    if (branchExists === null) {
      await this.git.checkoutBranch(targetBranch, 'main');
      this.logger.log(`Created new monthly branch ${targetBranch} from main`);
    } else {
      await this.git.checkout(targetBranch);
    }

    return targetBranch;
  }

  async prepareWritableWorkspace(): Promise<void> {
    await this.ensureWorkspaceBranchReady();
  }

  async recordCommittedContentChange(
    contentId: string,
    changeNote: string,
  ): Promise<string | null> {
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

    // GIT_AUTHOR_* / GIT_COMMITTER_* 等价于 git -c user.name=... -c user.email=...
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

  /** 每天凌晨 3 点自动 push + 检查月度切换 */
  @Cron('0 3 * * *')
  async scheduledSync(): Promise<void> {
    this.logger.log('Scheduled sync: checking branch and pushing...');
    await this.prepareWritableWorkspace();
    const result = await this.pushCurrentBranch();
    this.logger.log(`Scheduled sync result: ${result.message}`);
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
      });
  }
}
