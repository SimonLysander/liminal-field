import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { resolveAndEnsureContentRepoRoot } from './resolve-content-repo-root';

describe('resolveAndEnsureContentRepoRoot', () => {
  const base = join(process.cwd(), 'tmp-resolve-content-repo-test');
  let createdBase = false;

  beforeAll(() => {
    if (!existsSync(base)) {
      mkdirSync(base, { recursive: true });
      createdBase = true;
    }
  });

  afterAll(() => {
    if (createdBase && existsSync(base)) {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('keeps absolute paths and does not report created when dir exists', () => {
    const { absoluteRoot, created } = resolveAndEnsureContentRepoRoot(base);
    expect(absoluteRoot).toBe(base);
    expect(created).toBe(false);
  });

  it('resolves relative to cwd and creates missing directory', () => {
    const rel = join('tmp-resolve-content-repo-test', `nested-${Date.now()}`);
    const { absoluteRoot, created } = resolveAndEnsureContentRepoRoot(rel);
    expect(absoluteRoot).toBe(join(process.cwd(), rel));
    expect(created).toBe(true);
    expect(existsSync(absoluteRoot)).toBe(true);
    rmSync(absoluteRoot, { recursive: true, force: true });
  });

  it('throws when configured value is blank', () => {
    expect(() => resolveAndEnsureContentRepoRoot('  ')).toThrow(
      'content.repoRoot is empty',
    );
  });
});
