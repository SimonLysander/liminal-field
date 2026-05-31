/**
 * lifecycle-remote.e2e-spec.ts — 全流程集成:建内容 → 发布 → 推远端 → 清空 → 从远端恢复 → 重发。
 *
 * 用【本地 bare 仓(file://)】当 origin:既走真实的 push/clone/pull/recover 代码路径,
 * 又无网络抖动、绝不碰任何线上远端。覆盖本轮所有改动的端到端正确性:
 * - 条目作为独立子 ContentItem(自己的 content/<ci>/main.md)真的进 Git 并穿越远端往返
 * - 发布状态不进 Git、恢复后重置为未发布(per-node publishedVersion)
 * - sync-from-remote 清草稿(clear-local 修复)
 * - publish-all 一键重新上线(新功能)
 */
import supertest from 'supertest';
import { execFileSync } from 'child_process';
import { mkdtemp, rm, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getModelToken } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
  createAnthologyItem,
  addAnthologyEntry,
} from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { ContentRepository } from '../src/modules/content/content.repository';
import { EditorDraft } from '../src/modules/workspace/editor-draft.entity';

describe('全流程:建→发布→推远端→清→恢复→重发 (e2e, 本地 bare 仓当远端)', () => {
  let ctx: TestContext;
  let cookie: string;
  let bareRemoteDir: string;
  const prevRemoteUrl = process.env.KB_REMOTE_URL;
  const prevToken = process.env.KB_GIT_TOKEN;

  beforeAll(async () => {
    // 本地 bare 仓当 origin —— 真实 git 远端语义,无网络,绝不碰线上
    bareRemoteDir = await mkdtemp(join(tmpdir(), 'lf-bare-remote-'));
    execFileSync('git', ['init', '--bare', '-b', 'main', bareRemoteDir]);
    process.env.KB_REMOTE_URL = `file://${bareRemoteDir}`;
    delete process.env.KB_GIT_TOKEN; // file:// 无需凭据

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

  it('内容穿越「发布→推→清→恢复→重发」全程,发布状态不进 Git、恢复后重置、草稿被清', async () => {
    const server = ctx.app.getHttpServer();
    const repo = ctx.app.get(ContentRepository);
    const draftModel: ReturnModelType<typeof EditorDraft> = ctx.app.get(
      getModelToken('EditorDraft'),
    );
    const ENTRY_BODY = '条目正文必须穿越远端往返存活';

    // ── 1. 建内容:笔记(提交正文) + 文集(带正文条目) ──
    const noteId = await createNoteItem(ctx.app, cookie, '生命周期笔记');
    await commitNoteContent(
      ctx.app,
      cookie,
      noteId,
      '# 笔记正文\n\n内容。',
      '生命周期笔记',
    );
    const anthologyId = await createAnthologyItem(
      ctx.app,
      cookie,
      '生命周期文集',
    );
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, anthologyId, {
      title: '条目甲',
      bodyMarkdown: ENTRY_BODY,
    });

    // ── 2. 一键发布全部 ──
    const pub1 = await supertest(server)
      .post('/api/v1/settings/publish-all')
      .set('Cookie', cookie)
      .expect(201);
    expect(pub1.body.data.published).toBeGreaterThanOrEqual(2);
    expect((await repo.findById(noteId))?.publishedVersion).toBeTruthy();
    const anthBefore = await repo.findById(anthologyId);
    expect(anthBefore?.publishedVersion).toBeTruthy();
    // 条目子 ContentItem(entryKey 即其 id)各自上线
    expect((await repo.findById(entryKey))?.publishedVersion).toBeTruthy();

    // ── 3. 推到远端 → clone bare 仓断言文件穿越 ──
    const push = await supertest(server)
      .post('/api/v1/settings/push-to-remote')
      .set('Cookie', cookie)
      .expect(201);
    expect(push.body.data.success).toBe(true);

    const cloneDir = await mkdtemp(join(tmpdir(), 'lf-clone-'));
    execFileSync('git', ['clone', `file://${bareRemoteDir}`, cloneDir]);
    // 内容在 workspace/YYYY-MM 分支(main 仅归档),checkout 出来验
    const remoteBranches = execFileSync(
      'git',
      ['-C', cloneDir, 'branch', '-r'],
      {
        encoding: 'utf8',
      },
    );
    const wsRemote = remoteBranches
      .split('\n')
      .map((s) => s.trim())
      .find((b) => b.includes('workspace/'));
    expect(wsRemote).toBeTruthy(); // 远端必须有 workspace 分支
    execFileSync('git', [
      '-C',
      cloneDir,
      'checkout',
      wsRemote!.replace('origin/', ''),
    ]);
    const cloneContent = join(cloneDir, 'content');
    const idsInRemote = await readdir(cloneContent);
    expect(idsInRemote).toContain(anthologyId);
    expect(idsInRemote).toContain(noteId);
    // 条目是独立子 ContentItem(entryKey 即其 ci 目录);正文写在它自己的 main.md
    expect(idsInRemote).toContain(entryKey);
    const entryMd = await readFile(
      join(cloneContent, entryKey, 'main.md'),
      'utf8',
    );
    expect(entryMd).toContain(ENTRY_BODY);
    // 文集容器 main.md 只存 title/description,不含条目结构,也不含发布状态
    const mainMd = await readFile(
      join(cloneContent, anthologyId, 'main.md'),
      'utf8',
    );
    expect(mainMd).not.toContain('publishedVersionId');
    // manifest 在
    expect(await readdir(cloneDir)).toContain('.liminal-field.yaml');
    await rm(cloneDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });

    // ── 4. 播一条草稿(条目子 ContentItem 的普通草稿,fileName=null),再从远端恢复 ──
    await draftModel.create({
      _id: `draft:${entryKey}`,
      contentItemId: entryKey,
      bodyMarkdown: '草稿中…',
      title: '条目甲',
      changeNote: 'wip',
      savedAt: new Date(),
      fileName: null,
    });
    expect(await draftModel.countDocuments({})).toBe(1);

    const sync = await supertest(server)
      .post('/api/v1/settings/sync-from-remote')
      .set('Cookie', cookie)
      .expect(201);
    expect(sync.body.data.success).toBe(true);
    expect(sync.body.data.recovered).toBeGreaterThanOrEqual(2);

    // ── 5. 断言恢复结果 ──
    const noteAfter = await repo.findById(noteId);
    const anthAfter = await repo.findById(anthologyId);
    expect(noteAfter).toBeTruthy();
    expect(anthAfter).toBeTruthy();
    // 发布状态重置为未发布(发布状态不进 Git)
    expect(noteAfter?.publishedVersion ?? null).toBeNull();
    expect(anthAfter?.publishedVersion ?? null).toBeNull();
    // 条目子 ContentItem 恢复后也未发布
    expect(
      (await repo.findById(entryKey))?.publishedVersion ?? null,
    ).toBeNull();
    // Phase 1:子节点正文走 /public/ 阅读端路由(带 cookie = 管理端语义,读最新)
    const entryDetail = await supertest(server)
      .get(
        `/api/v1/spaces/anthology/public/items/${anthologyId}/entries/${entryKey}`,
      )
      .set('Cookie', cookie)
      .expect(200);
    expect(entryDetail.body.data.bodyMarkdown).toContain(ENTRY_BODY);
    // 草稿被 sync 清掉
    expect(await draftModel.countDocuments({})).toBe(0);

    // ── 6. 恢复后一键重发,重新上线 ──
    const pub2 = await supertest(server)
      .post('/api/v1/settings/publish-all')
      .set('Cookie', cookie)
      .expect(201);
    expect(pub2.body.data.published).toBeGreaterThanOrEqual(2);
    expect((await repo.findById(anthologyId))?.publishedVersion).toBeTruthy();
    // 条目子 ContentItem 也重新上线
    expect((await repo.findById(entryKey))?.publishedVersion).toBeTruthy();
  }, 180_000);
});
