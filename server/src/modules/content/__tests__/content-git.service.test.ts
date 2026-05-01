import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import simpleGit from 'simple-git';
import { ContentGitService } from '../content-git.service';
import { ContentRepoService } from '../content-repo.service';

jest.mock('simple-git');
const mockSimpleGit = simpleGit as jest.MockedFunction<typeof simpleGit>;

describe('ContentGitService', () => {
  const knowledgeBaseRoot = '/tmp/test-content-git-service';
  const contentRoot = join(knowledgeBaseRoot, 'content');

  let service: ContentGitService;
  let contentRepoService: jest.Mocked<ContentRepoService>;
  let mockGit: Record<string, jest.Mock>;

  const now = new Date();
  const expectedWorkBranch = `workspace/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  beforeEach(() => {
    mockGit = {
      raw: jest.fn(),
      status: jest.fn(),
      add: jest.fn(),
      revparse: jest.fn(),
      branch: jest.fn(),
      checkout: jest.fn(),
      checkoutBranch: jest.fn(),
      merge: jest.fn(),
      push: jest.fn(),
      env: jest.fn(),
    };
    // env() must return the same mock so git.env({...}).raw([...]) chains correctly
    mockGit.env.mockReturnValue(mockGit);
    mockSimpleGit.mockReturnValue(mockGit as any);

    contentRepoService = {
      getContentDirectoryPath: jest.fn((contentId: string) =>
        join(contentRoot, contentId),
      ),
    } as unknown as jest.Mocked<ContentRepoService>;

    const configService = {
      getOrThrow: () => knowledgeBaseRoot,
    } as unknown as ConfigService;

    service = new ContentGitService(contentRepoService, configService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('switches to the work branch before recording content commits', async () => {
    // ensureWorkspaceBranchReady: current branch is main (not target)
    mockGit.raw.mockResolvedValueOnce('main');
    // ensureMainBranch: show-ref for main → exists (returns non-null)
    mockGit.raw.mockResolvedValueOnce('');
    // status: clean
    mockGit.status.mockResolvedValueOnce({ isClean: () => true });
    // show-ref for workspace branch → doesn't exist (tryRun catches → null)
    mockGit.raw.mockRejectedValueOnce(new Error('not found'));
    // checkoutBranch(targetBranch, 'main')
    mockGit.checkoutBranch.mockResolvedValueOnce(undefined);
    // add tracked path
    mockGit.add.mockResolvedValueOnce('');
    // diff --cached → has staged content
    mockGit.raw.mockResolvedValueOnce('content/ci_test/main.md');
    // commit via git.env({...}).raw([...])
    mockGit.raw.mockResolvedValueOnce('');
    // revparse HEAD
    mockGit.revparse.mockResolvedValueOnce('def456');

    const commitHash = await service.recordCommittedContentChange(
      'ci_test',
      'Commit note',
    );

    expect(commitHash).toBe('def456');
    expect(mockGit.checkoutBranch).toHaveBeenCalledWith(
      expectedWorkBranch,
      'main',
    );
    expect(mockGit.env).toHaveBeenCalledWith(
      expect.objectContaining({
        GIT_AUTHOR_NAME: expect.any(String),
        GIT_AUTHOR_EMAIL: expect.any(String),
        GIT_COMMITTER_NAME: expect.any(String),
        GIT_COMMITTER_EMAIL: expect.any(String),
      }),
    );
  });

  it('skips git commit when the staged diff is empty', async () => {
    // Already on the correct work branch — ensureWorkspaceBranchReady returns early
    mockGit.raw.mockResolvedValueOnce(expectedWorkBranch);
    // add tracked path
    mockGit.add.mockResolvedValueOnce('');
    // diff --cached → empty (nothing staged)
    mockGit.raw.mockResolvedValueOnce('');

    const commitHash = await service.recordCommittedContentChange(
      'ci_test',
      'Commit note',
    );

    expect(commitHash).toBeNull();
    expect(mockGit.env).not.toHaveBeenCalled();
  });

  it('lists commit history for a tracked content directory', async () => {
    const rawLog = [
      'abc123',
      '2026-04-20T09:00:00.000Z',
      'Liminal Field',
      'no-reply@liminal-field.local',
      'content(ci_test): commit | Commit note',
    ].join('\x1f');
    mockGit.raw.mockResolvedValueOnce(rawLog);

    const result = await service.listContentHistory('ci_test');

    expect(result).toEqual([
      {
        commitHash: 'abc123',
        committedAt: '2026-04-20T09:00:00.000Z',
        authorName: 'Liminal Field',
        authorEmail: 'no-reply@liminal-field.local',
        message: 'content(ci_test): commit | Commit note',
        action: 'commit',
      },
    ]);
    // listContentHistory reads only — no branch switching, no prepareWritableWorkspace
    expect(mockGit.checkout).not.toHaveBeenCalled();
    expect(mockGit.checkoutBranch).not.toHaveBeenCalled();
  });
});
