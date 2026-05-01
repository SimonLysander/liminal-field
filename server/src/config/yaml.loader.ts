import { readFileSync } from 'fs';
import { join } from 'path';
import * as yaml from 'js-yaml';

export const yamlLoader = () =>
  yaml.load(
    readFileSync(join(process.cwd(), 'configs/db.yaml'), 'utf8'),
  ) as Record<string, unknown>;
