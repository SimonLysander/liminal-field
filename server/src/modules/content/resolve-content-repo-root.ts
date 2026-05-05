import { existsSync, mkdirSync } from 'fs';
import { isAbsolute, resolve } from 'path';

/**
 * 解析 `content.repoRoot`：绝对路径原样使用；相对路径相对 **当前 Node 进程 cwd**
 *（本地 `pnpm start:dev` 时一般为 `server/`）。
 *
 * simple-git 要求工作目录已存在，故在目录缺失时同步 `mkdir -p`，由调用方打日志。
 */
export function resolveAndEnsureContentRepoRoot(configured: string): {
  absoluteRoot: string;
  created: boolean;
} {
  const trimmed = configured.trim();
  if (!trimmed) {
    throw new Error('content.repoRoot is empty');
  }
  const absoluteRoot = isAbsolute(trimmed)
    ? trimmed
    : resolve(process.cwd(), trimmed);
  const existed = existsSync(absoluteRoot);
  if (!existed) {
    mkdirSync(absoluteRoot, { recursive: true });
  }
  return { absoluteRoot, created: !existed };
}
