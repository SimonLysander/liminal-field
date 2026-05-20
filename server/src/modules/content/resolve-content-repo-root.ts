import { existsSync, mkdirSync } from 'fs';
import { isAbsolute, resolve } from 'path';

/**
 * 解析 `content.repoRoot`：绝对路径原样使用；
 * 相对路径相对 server/ 目录（即 __dirname 的上三级）。
 *
 * 为什么不用 process.cwd()：cwd 取决于进程启动方式（IDE、脚本、Docker），
 * 不稳定。如果 cwd 是项目根而非 server/，相对路径会解析到错误位置，
 * 导致 simple-git 沿父目录找到项目代码仓库的 .git，污染项目 remote。
 *
 * simple-git 要求工作目录已存在，故在目录缺失时同步 `mkdir -p`，由调用方打日志。
 */

/** server/ 目录的绝对路径（__dirname 是 server/src/modules/content/） */
const SERVER_ROOT = resolve(__dirname, '..', '..', '..');

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
    : resolve(SERVER_ROOT, trimmed);
  const existed = existsSync(absoluteRoot);
  if (!existed) {
    mkdirSync(absoluteRoot, { recursive: true });
  }
  return { absoluteRoot, created: !existed };
}
