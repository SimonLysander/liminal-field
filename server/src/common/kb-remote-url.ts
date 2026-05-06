/**
 * KB Git 远程：允许 KB_REMOTE_URL 只写无凭证 HTTPS，凭据放在 KB_GIT_TOKEN（classic / fine-grained PAT 均可）。
 * 自动拼接仅针对 https://github.com/...；其它主机请把账号/token 直接写进 KB_REMOTE_URL。
 */
export function applyKbGitTokenToGithubHttps(
  rawUrl: string,
  token: string | undefined,
): string {
  const tokenTrim = token?.trim();
  if (!tokenTrim) return rawUrl;

  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return rawUrl;
    if (u.hostname !== 'github.com') return rawUrl;
    if (u.username || u.password) return rawUrl;

    const tail = `${u.pathname}${u.search}${u.hash}`;
    return `https://x-access-token:${encodeURIComponent(tokenTrim)}@${u.host}${tail}`;
  } catch {
    return rawUrl;
  }
}

export function resolveKbRemoteUrlForGit(): string | undefined {
  const raw = process.env.KB_REMOTE_URL?.trim();
  if (!raw) return undefined;
  return applyKbGitTokenToGithubHttps(raw, process.env.KB_GIT_TOKEN);
}

/** 打日志用：遮掉 URL 中的 password（含 PAT）。 */
export function redactKbRemoteUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[invalid-url]';
  }
}
