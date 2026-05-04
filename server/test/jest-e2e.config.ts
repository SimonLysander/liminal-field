import type { Config } from 'jest';
import { createDefaultPreset } from 'ts-jest';

// 与根 jest.config.ts 相同的 ts-jest 配置：覆盖 tsconfig module 为 CJS，
// 因为 Jest 运行时是 CommonJS，而项目 tsconfig 使用 nodenext。
const tsJestPreset = createDefaultPreset({
  tsconfig: {
    module: 'CommonJS',
    moduleResolution: 'node',
    target: 'ES2023',
    resolvePackageJsonExports: false,
  },
});

const config: Config = {
  ...tsJestPreset,
  moduleFileExtensions: ['js', 'json', 'ts'],
  // rootDir 指向项目根（相对于本配置文件在 test/ 目录下）
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  testEnvironment: 'node',
  // e2e 测试涉及 MongoDB + Git + HTTP，需要更长的超时
  testTimeout: 30000,
  // 每个测试文件独立进程，避免 MongoDB 连接/Git 目录相互污染
  maxWorkers: 1,
};

export default config;
