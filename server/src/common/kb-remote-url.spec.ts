import {
  applyKbGitTokenToGithubHttps,
  redactKbRemoteUrlForLog,
} from './kb-remote-url';

describe('applyKbGitTokenToGithubHttps', () => {
  it('returns plain github https unchanged when token empty', () => {
    const u = 'https://github.com/o/r.git';
    expect(applyKbGitTokenToGithubHttps(u, undefined)).toBe(u);
    expect(applyKbGitTokenToGithubHttps(u, '   ')).toBe(u);
  });

  it('injects x-access-token for bare github https', () => {
    expect(
      applyKbGitTokenToGithubHttps('https://github.com/o/r.git', 'ghp_abc'),
    ).toBe('https://x-access-token:ghp_abc@github.com/o/r.git');
  });

  it('does not inject when URL already has userinfo', () => {
    const u = 'https://x-access-token:already@github.com/o/r.git';
    expect(applyKbGitTokenToGithubHttps(u, 'ghp_new')).toBe(u);
  });

  it('does not inject for non-github host', () => {
    const u = 'https://gitlab.com/o/r.git';
    expect(applyKbGitTokenToGithubHttps(u, 'tok')).toBe(u);
  });

  it('encodes token for URL', () => {
    expect(
      applyKbGitTokenToGithubHttps('https://github.com/o/r.git', 'has/special'),
    ).toBe('https://x-access-token:has%2Fspecial@github.com/o/r.git');
  });
});

describe('redactKbRemoteUrlForLog', () => {
  it('masks password', () => {
    expect(
      redactKbRemoteUrlForLog(
        'https://x-access-token:secret@github.com/o/r.git',
      ),
    ).toBe('https://x-access-token:***@github.com/o/r.git');
  });
});
