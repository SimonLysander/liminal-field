import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

/**
 * 加载 .env → 读 db.yaml → 替换 ${VAR} → 返回配置对象。
 *
 * .env 查找顺序：server/.env → 项目根/.env（../）
 * Docker 通过 docker-compose environment 注入，不依赖 .env 文件。
 */
export const yamlLoader = () => {
  // 加载 .env（本地开发用；Docker 环境变量已由 compose 注入）
  loadDotEnv();

  let raw = readFileSync(join(process.cwd(), 'configs/db.yaml'), 'utf8');
  raw = raw.replace(
    /\$\{(\w+)\}/g,
    (_sub: string, key: string) => process.env[key] ?? '',
  );
  return yaml.load(raw) as Record<string, unknown>;
};

/** 简易 .env 加载：不覆盖已有环境变量 */
function loadDotEnv(): void {
  const candidates = [
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '.env'),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      // 不覆盖已有环境变量（Docker compose 设置的优先）
      if (!(key in process.env)) {
        process.env[key] = val;
      }
    }
    // 不 break：继续加载其他候选文件，已有变量不覆盖
  }
}
