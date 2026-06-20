/**
 * PromptManagerService — 全局 prompt 模板管理。
 *
 * 启动时扫描 server/src/prompts/**\/*.md（dist 环境下是 dist/prompts/）
 * 将所有 .md 内容缓存进 Map<name, content>，name 形如 'digest/react-agent.md'。
 *
 * render(name, vars) 用 {{var_name}} Mustache 风格替换变量，找不到 prompt 文件抛错。
 *
 * 关键：NestJS SWC 编译不会复制非 .ts 文件；已在 nest-cli.json compilerOptions.assets
 * 加了 prompts/**\/*.md → 编译后 .md 复制进 dist/prompts/。
 * 运行时 prompts 目录路径通过 __dirname 定位：
 *   - dev (ts-node): __dirname = src/infrastructure/prompt → ../../prompts
 *   - prod (node dist): __dirname = dist/infrastructure/prompt → ../../prompts
 * 两者层级相同，统一处理。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PromptManagerService implements OnModuleInit {
  private readonly logger = new Logger(PromptManagerService.name);
  private readonly cache = new Map<string, string>();
  private readonly promptsDir: string;

  constructor() {
    // __dirname: src/infrastructure/prompt (dev) 或 dist/infrastructure/prompt (prod)
    // prompts 目录在 src/prompts 或 dist/prompts，两层向上再进 prompts
    this.promptsDir = path.resolve(__dirname, '../../prompts');
  }

  onModuleInit(): void {
    this.loadAll();
  }

  /** 递归扫描 promptsDir，将所有 .md 缓存进 Map */
  private loadAll(): void {
    if (!fs.existsSync(this.promptsDir)) {
      this.logger.warn(`prompts 目录不存在，跳过加载: ${this.promptsDir}`);
      return;
    }

    const files = this.walkMdFiles(this.promptsDir);
    for (const absPath of files) {
      const relName = path
        .relative(this.promptsDir, absPath)
        .replace(/\\/g, '/'); // Windows 兼容
      const content = fs.readFileSync(absPath, 'utf8');
      this.cache.set(relName, content);
      this.logger.debug(`已加载 prompt: ${relName} (${content.length} chars)`);
    }

    this.logger.log(
      `PromptManager 初始化完成，共加载 ${this.cache.size} 个 prompt`,
    );
  }

  /** 递归找出目录下所有 .md 文件 */
  private walkMdFiles(dir: string): string[] {
    const result: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...this.walkMdFiles(full));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        result.push(full);
      }
    }
    return result;
  }

  /**
   * 渲染 prompt 模板，替换 {{var_name}} 占位符。
   *
   * @param name   相对路径，形如 'digest/react-agent.md'
   * @param vars   变量 map，key 对应模板中 {{key}}
   * @throws Error 找不到 prompt 文件时抛出
   */
  render(name: string, vars: Record<string, string> = {}): string {
    const template = this.cache.get(name);
    if (template === undefined) {
      throw new Error(`prompt not found: ${name}`);
    }

    return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      // 变量未传时保留原占位（方便调试），并打 warn
      if (!(key in vars)) {
        this.logger.warn(`prompt '${name}' 变量未提供: {{${key}}}`);
        return `{{${key}}}`;
      }
      return vars[key];
    });
  }

  /** 获取所有已缓存的 prompt 名（调试用） */
  listLoaded(): string[] {
    return [...this.cache.keys()];
  }
}
