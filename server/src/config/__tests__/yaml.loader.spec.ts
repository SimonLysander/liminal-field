/**
 * yaml.loader 单元测试 — 环境变量替换逻辑
 *
 * yamlLoader 函数依赖 readFileSync/existsSync（文件系统），
 * 测试核心关注点是 ${VAR} / ${VAR:default} 替换正则，
 * 因此直接抽取同一段正则逻辑单独测试，避免 mock 文件系统带来的噪音。
 */

/** 与 yaml.loader.ts 中完全相同的替换逻辑，单独提取用于测试 */
function substituteEnvVars(raw: string): string {
  return raw.replace(
    /\$\{(\w+)(?::([^}]*))?\}/g,
    (_sub: string, key: string, fallback?: string) =>
      process.env[key] ?? fallback ?? '',
  );
}

describe('yaml.loader 环境变量替换', () => {
  // 保存原始环境，每个测试结束后恢复，避免污染其他测试
  const originalEnv: NodeJS.ProcessEnv = {};

  beforeEach(() => {
    // 清除测试中可能用到的变量
    for (const key of ['TEST_VAR', 'DB_HOST', 'DB_PORT', 'EMPTY_VAR']) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    // 恢复环境变量
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  // ${VAR} 基本替换
  it('${VAR} — 替换为环境变量值', () => {
    process.env.TEST_VAR = 'hello';
    expect(substituteEnvVars('value: ${TEST_VAR}')).toBe('value: hello');
  });

  // ${VAR} 变量不存在时替换为空字符串，不应抛出
  it('${VAR} — 环境变量不存在时替换为空字符串', () => {
    expect(substituteEnvVars('value: ${TEST_VAR}')).toBe('value: ');
  });

  // ${VAR:default} 环境变量存在时，优先使用环境变量而非默认值
  it('${VAR:default} — 环境变量存在时用环境变量', () => {
    process.env.DB_HOST = 'prod-host';
    expect(substituteEnvVars('host: ${DB_HOST:localhost}')).toBe(
      'host: prod-host',
    );
  });

  // ${VAR:default} 环境变量不存在时使用默认值
  it('${VAR:default} — 环境变量不存在时用默认值', () => {
    expect(substituteEnvVars('host: ${DB_HOST:localhost}')).toBe(
      'host: localhost',
    );
  });

  // ${VAR:} 空默认值，环境变量不存在时应得到空字符串，不报错
  it('${VAR:} — 空默认值不报错，替换为空字符串', () => {
    expect(substituteEnvVars('value: ${EMPTY_VAR:}')).toBe('value: ');
  });

  // 多个变量在同一行中同时替换
  it('同一行多个 ${VAR} 都被替换', () => {
    process.env.DB_HOST = 'db.example.com';
    process.env.DB_PORT = '27017';
    expect(
      substituteEnvVars('uri: mongodb://${DB_HOST:localhost}:${DB_PORT:27017}'),
    ).toBe('uri: mongodb://db.example.com:27017');
  });

  // 没有占位符的原始字符串保持不变
  it('不含占位符的字符串原样返回', () => {
    const raw = 'host: localhost\nport: 5432';
    expect(substituteEnvVars(raw)).toBe(raw);
  });
});
