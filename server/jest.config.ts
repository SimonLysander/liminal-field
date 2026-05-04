import type { Config } from 'jest';
import { createDefaultPreset } from 'ts-jest';

// ts-jest preset：覆盖 tsconfig module 为 CommonJS，
// 因为 Jest 运行时是 CJS，而项目 tsconfig 使用 nodenext（无 type:module）。
// resolvePackageJsonExports 仅在 nodenext/bundler 下有效，切到 CommonJS 时必须显式关掉。
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
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
};

export default config;
