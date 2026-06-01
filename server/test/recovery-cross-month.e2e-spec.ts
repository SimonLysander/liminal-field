/**
 * recovery-cross-month.e2e-spec.ts — 跨月恢复回归。
 *
 * 守护的 bug:内容存在 workspace/YYYY-MM 月分支,而 pullFromRemote 恢复时算「当月」分支名,
 * 若 origin 没有当月分支(内容是别的月推的、且未跨月归档进 main)→ 旧逻辑 fallback 到空 main
 * → 恢复出 0 内容。修复:fallback 到 origin 上【最近的 workspace 分支】,而非空 main。
 *
 * 复现手法:推送后,把 bare 远端的 workspace/<当月> 分支改名为过去月份(workspace/2000-01),
 * 使「当月」分支在 origin 不存在,触发跨月场景——无需改系统时钟。
 */
import supertest from 'supertest';
import { execFileSync } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
  createAnthologyItem,
  createAnthologyChildNode,
} from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { ContentRepository } from '../src/modules/content/content.repository';

describe('跨月恢复 (e2e, 本地 bare 仓当远端)', () => {
  let ctx: TestContext;
  let cookie: string;
  let bareRemoteDir: string;
  const prevRemoteUrl = process.env.KB_REMOTE_URL;
  const prevToken = process.env.KB_GIT_TOKEN;

  beforeAll(async () => {
    bareRemoteDir = await mkdtemp(join(tmpdir(), 'lf-xmonth-remote-'));
    execFileSync('git', ['init', '--bare', '-b', 'main', bareRemoteDir]);
    process.env.KB_REMOTE_URL = `file://${bareRemoteDir}`;
    delete process.env.KB_GIT_TOKEN;
    ctx = new TestContext();
    await ctx.setup([SettingsModule]);
    cookie = await login(ctx.app);
  }, 180_000);

  afterAll(async () => {
    await ctx.teardown();
    if (bareRemoteDir)
      await rm(bareRemoteDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    if (prevRemoteUrl === undefined) delete process.env.KB_REMOTE_URL;
    else process.env.KB_REMOTE_URL = prevRemoteUrl;
    if (prevToken === undefined) delete process.env.KB_GIT_TOKEN;
    else process.env.KB_GIT_TOKEN = prevToken;
  });

  it('当月 workspace 分支不存在时,从最近的 workspace 分支恢复内容(而非空 main)', async () => {
    const server = ctx.app.getHttpServer();
    const repo = ctx.app.get(ContentRepository);
    const ENTRY_BODY = '跨月恢复必须找回的条目正文';

    // 建内容 + 推远端
    const noteId = await createNoteItem(ctx.app, cookie, '跨月笔记');
    await commitNoteContent(
      ctx.app,
      cookie,
      noteId,
      '# 跨月\n\n正文。',
      '跨月笔记',
    );
    const anthologyId = await createAnthologyItem(ctx.app, cookie, '跨月文集');
    const childNodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      anthologyId,
      '条目',
      ENTRY_BODY,
    );
    await supertest(server)
      .post('/api/v1/settings/push-to-remote')
      .set('Cookie', cookie)
      .expect(201);

    // 把 bare 远端的当月 workspace 分支改名为过去月份 → 制造"当月分支不存在于 origin"
    const bareBranches = execFileSync(
      'git',
      ['-C', bareRemoteDir, 'branch', '--format=%(refname:short)'],
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const ws = bareBranches.find((b) => b.startsWith('workspace/'));
    expect(ws).toBeTruthy();
    execFileSync('git', [
      '-C',
      bareRemoteDir,
      'branch',
      '-m',
      ws!,
      'workspace/2000-01',
    ]);

    // 从远端恢复(当月分支在 origin 不存在 → 必须落到最近的 workspace/2000-01,而非空 main)
    const sync = await supertest(server)
      .post('/api/v1/settings/sync-from-remote')
      .set('Cookie', cookie)
      .expect(201);
    expect(sync.body.data.success).toBe(true);
    // 关键断言:内容被恢复(旧 bug 这里是 0)
    expect(sync.body.data.recovered).toBeGreaterThanOrEqual(2);

    // 内容确实回来了
    expect(await repo.findById(noteId)).toBeTruthy();
    expect(await repo.findById(anthologyId)).toBeTruthy();
    // Phase 1:阅读端走 /public/ 路由,nodeId 即子节点 contentItemId
    const entryDetail = await supertest(server)
      .get(
        `/api/v1/spaces/anthology/public/items/${anthologyId}/entries/${childNodeId}`,
      )
      .set('Cookie', cookie)
      .expect(200);
    expect(entryDetail.body.data.bodyMarkdown).toContain(ENTRY_BODY);
  }, 180_000);
});
