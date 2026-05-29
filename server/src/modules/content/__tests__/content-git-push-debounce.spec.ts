/**
 * content-git-push-debounce.spec.ts — commit 后去抖自动 push 的调度逻辑单测。
 *
 * 守的行为:每次成功 commit(recordCommittedContentChange)后,按 GIT_PUSH_DEBOUNCE_MS
 * 去抖调度一次 pushCurrentBranch——把"距上次 push 的灾难丢失窗口"压到去抖级别,又不至于
 * 每次 commit 都打远端。触发轴只挂"会改 git 内容的 commit",与 publish 等业务状态无关。
 *
 * 用 fake timers 确定性验证调度,spy 掉公共 pushCurrentBranch 绕开真实 git 远端。
 * (放在 .spec.ts 而非同目录的 .test.ts:根 jest testRegex 只认 .spec.ts,.test.ts 不会被跑。)
 */
import simpleGit from 'simple-git';
import { ContentGitService } from '../content-git.service';
import { ContentRepoService } from '../content-repo.service';
import type { ContentSnapshotRepository } from '../content-snapshot.repository';
import type { ContentRepository } from '../content.repository';

jest.mock('simple-git');
const mockSimpleGit = simpleGit as jest.MockedFunction<typeof simpleGit>;

describe('ContentGitService 去抖自动 push', () => {
  const repoRoot = '/tmp/test-content-git-push-debounce';
  const now = new Date();
  const workBranch = `workspace/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let service: ContentGitService;
  let mockGit: Record<string, jest.Mock>;
  const prevDebounce = process.env.GIT_PUSH_DEBOUNCE_MS;
  const prevSync = process.env.GIT_SYNC_ENABLED;

  beforeEach(() => {
    mockGit = {
      raw: jest.fn(),
      add: jest.fn(),
      revparse: jest.fn(),
      branchLocal: jest.fn(),
      checkout: jest.fn(),
      env: jest.fn(),
      push: jest.fn(),
    };
    mockGit.env.mockReturnValue(mockGit); // git.env({...}).raw([...]) 链式
    mockSimpleGit.mockReturnValue(mockGit as never);

    const contentRepoService = {
      repoRoot,
      getContentDirectoryPath: (id: string) => `${repoRoot}/content/${id}`,
    } as unknown as ContentRepoService;

    service = new ContentGitService(
      contentRepoService,
      {} as unknown as ContentSnapshotRepository,
      {} as unknown as ContentRepository,
    );

    process.env.GIT_SYNC_ENABLED = 'true';
  });

  afterEach(() => {
    service.onModuleDestroy(); // 清掉可能挂起的去抖定时器
    jest.useRealTimers();
    if (prevDebounce === undefined) delete process.env.GIT_PUSH_DEBOUNCE_MS;
    else process.env.GIT_PUSH_DEBOUNCE_MS = prevDebounce;
    if (prevSync === undefined) delete process.env.GIT_SYNC_ENABLED;
    else process.env.GIT_SYNC_ENABLED = prevSync;
    jest.restoreAllMocks();
  });

  /** 排好一次"成功提交"的 git mock 返回(已在当月分支 → ensureWorkspaceBranchReady 提前返回)。 */
  function primeSuccessfulCommit(): void {
    mockGit.branchLocal.mockResolvedValueOnce({
      current: workBranch,
      all: [workBranch],
    });
    mockGit.add.mockResolvedValueOnce('');
    mockGit.raw.mockResolvedValueOnce('content/ci_test/main.md'); // diff --cached
    mockGit.raw.mockResolvedValueOnce(''); // commit
    mockGit.revparse.mockResolvedValueOnce('hash123');
  }

  it('commit 成功后到达去抖窗口才推一次 push', async () => {
    process.env.GIT_PUSH_DEBOUNCE_MS = '15000';
    jest.useFakeTimers();
    primeSuccessfulCommit();
    const pushSpy = jest
      .spyOn(service, 'pushCurrentBranch')
      .mockResolvedValue({ success: true, message: 'ok' });

    const hash = await service.recordCommittedContentChange('ci_test', 'note');
    expect(hash).toBe('hash123');
    expect(pushSpy).not.toHaveBeenCalled(); // 窗口未到,先不推

    jest.advanceTimersByTime(15000);
    await Promise.resolve(); // flush debouncedPush 微任务
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('窗口设 0 时关闭自动 push(测试/特殊部署)', async () => {
    process.env.GIT_PUSH_DEBOUNCE_MS = '0';
    jest.useFakeTimers();
    primeSuccessfulCommit();
    const pushSpy = jest
      .spyOn(service, 'pushCurrentBranch')
      .mockResolvedValue({ success: true, message: 'ok' });

    await service.recordCommittedContentChange('ci_test', 'note');
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('连续两次 commit 去抖合并为一次 push', async () => {
    process.env.GIT_PUSH_DEBOUNCE_MS = '15000';
    jest.useFakeTimers();
    const pushSpy = jest
      .spyOn(service, 'pushCurrentBranch')
      .mockResolvedValue({ success: true, message: 'ok' });

    primeSuccessfulCommit();
    await service.recordCommittedContentChange('ci_test', 'note1');
    jest.advanceTimersByTime(5_000); // 窗口未满又来一次 → 重置
    primeSuccessfulCommit();
    await service.recordCommittedContentChange('ci_test', 'note2');

    jest.advanceTimersByTime(15_000);
    await Promise.resolve();
    expect(pushSpy).toHaveBeenCalledTimes(1); // 合并成一次
  });
});
