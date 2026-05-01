import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

export const yamlLoader = () => {
  let raw = readFileSync(
    join(process.cwd(), 'configs/db.yaml'),
    'utf8',
  );
  // 支持 ${ENV_VAR} 环境变量替换，方便 Docker 部署时从 .env 注入
  raw = raw.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? '');
  return yaml.load(raw) as Record<string, unknown>;
};
