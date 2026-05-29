/**
 * page-tree-sync-recovery.e2e-spec.ts — 统一页面树「同步 + 灾难恢复」回归。
 *
 * 老坏点:Git 同步/恢复反复丢数据(条目正文丢、清单没推、隔月丢内容)。统一页面树
 * Phase1+2 后**文件夹也自带正文/ContentItem**、清单 type 改为按子节点数计算——恰好动了
 * 归档与恢复最脆弱那层。既有 lifecycle-remote 只覆盖「扁平笔记 + 文集条目」,本套件补齐:
 *
 *   A. 文件夹自带正文 + 子节点,远端往返(招牌回归——旧的「父级正文丢失」bug 长在这层)
 *   B. 三层嵌套树结构还原(父链完整重建)
 *   C. 文件夹有子节点但正文从未提交(悬挂节点假设:git 无其目录,恢复别建出指向空的死节点)
 *
 * 手段:本地 bare 仓(file://)当 origin,走真实 push/clone/pull/recover 代码路径,
 * 无网络、绝不碰线上 39.106.105.37。隔离沿用 helpers 的 MongoMemoryServer + 临时 Git 仓。
 */
import supertest from 'supertest';
import { execFileSync } from 'child_process';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as yaml from 'js-yaml';
import simpleGit from 'simple-git';
import { TestContext, login, commitNoteContent } from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { ContentGitService } from '../src/modules/content/content-git.service';
import { ContentRepository } from '../src/modules/content/content.repository';
import { ContentSnapshotRepository } from '../src/modules/content/content-snapshot.repository';
import { NavigationRepository } from '../src/modules/navigation/navigation.repository';

describe('统一页面树:同步 + 灾难恢复 (e2e, 本地 bare 仓当远端)', () => {
  let ctx: TestContext;
  let cookie: string;
  let server: ReturnType<TestContext['app']['getHttpServer']>;
  let bareRemoteDir: string;
  const prevRemoteUrl = process.env.KB_REMOTE_URL;
  const prevToken = process.env.KB_GIT_TOKEN;

  beforeAll(async () => {
    bareRemoteDir = await mkdtemp(join(tmpdir(), 'lf-pt-bare-'));
    execFileSync('git', ['init', '--bare', '-b', 'main', bareRemoteDir]);
    process.env.KB_REMOTE_URL = `file://${bareRemoteDir}`;
    delete process.env.KB_GIT_TOKEN; // file:// 无需凭据

    ctx = new TestContext();
    await ctx.setup([SettingsModule]);
    cookie = await login(ctx.app);
    server = ctx.app.getHttpServer();
  }, 180_000);

  afterAll(async () => {
    await ctx.teardown();
    if (bareRemoteDir)
      await rm(bareRemoteDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (prevRemoteUrl === undefined) delete process.env.KB_REMOTE_URL;
    else process.env.KB_REMOTE_URL = prevRemoteUrl;
    if (prevToken === undefined) delete process.env.KB_GIT_TOKEN;
    else process.env.KB_GIT_TOKEN = prevToken;
  });

  // ── 帮手 ────────────────────────────────────────────────────────────────

  /** 建一个 notes 节点(可选挂在 parentId 下),返回它的导航节点 id 与自带 contentItemId。 */
  async function createNode(
    name: string,
    parentId?: string,
  ): Promise<{ nodeId: string; ci: string }> {
    const res = await supertest(server)
      .post('/api/v1/structure-nodes')
      .set('Cookie', cookie)
      .send({
        name,
        scope: 'notes',
        type: 'DOC',
        ...(parentId ? { parentId } : {}),
      })
      .expect(201);
    return { nodeId: res.body.data.id, ci: res.body.data.contentItemId };
  }

  /**
   * 提交某节点的正文,并【等到 fire-and-forget 的 archiveToGit 把 main.md 写盘并被 git 跟踪】
   * 再返回——确保 push 前内容确实已落 Git(否则 push 出去是空的,正是要守的 race)。
   */
  async function commitBodyAndAwaitArchive(
    ci: string,
    body: string,
    title: string,
  ): Promise<void> {
    await commitNoteContent(ctx.app, cookie, ci, body, title);
    const rel = `content/${ci}/main.md`;
    const git = simpleGit(ctx.tmpGitDir);
    for (let i = 0; i < 80; i++) {
      const tracked = (await git.raw(['ls-files', rel])).trim();
      if (tracked === rel) return;
      // 兜底催一把归档(retryPendingArchives 幂等:无 diff/锁占用时自行跳过)
      await ctx.app
        .get(ContentGitService)
        .retryPendingArchives()
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`archive 超时:${rel} 未被 git 跟踪`);
  }

  /** publish-all → push-to-remote(内部 writeManifest + commit + push)。 */
  async function publishAndPush(): Promise<void> {
    await supertest(server)
      .post('/api/v1/settings/publish-all')
      .set('Cookie', cookie)
      .expect(201);
    const push = await supertest(server)
      .post('/api/v1/settings/push-to-remote')
      .set('Cookie', cookie)
      .expect(201);
    expect(push.body.data.success).toBe(true);
  }

  /** 清 Mongo 三仓 → sync-from-remote(重新 clone + 恢复)。 */
  async function wipeMongoAndSync(): Promise<void> {
    await ctx.app.get(ContentRepository).deleteAll();
    await ctx.app.get(ContentSnapshotRepository).deleteAll();
    await ctx.app.get(NavigationRepository).deleteAll();
    const sync = await supertest(server)
      .post('/api/v1/settings/sync-from-remote')
      .set('Cookie', cookie)
      .expect(201);
    expect(sync.body.data.success).toBe(true);
  }

  /** clone 出 bare 仓的 workspace 分支到临时目录,返回其 content/ 路径(用完自行清理)。 */
  async function cloneRemoteWorkspace(): Promise<{
    dir: string;
    content: string;
  }> {
    const dir = await mkdtemp(join(tmpdir(), 'lf-pt-clone-'));
    execFileSync('git', ['clone', `file://${bareRemoteDir}`, dir]);
    const remoteBranches = execFileSync('git', ['-C', dir, 'branch', '-r'], {
      encoding: 'utf8',
    });
    const ws = remoteBranches
      .split('\n')
      .map((s) => s.trim())
      .find((b) => b.includes('workspace/'));
    expect(ws).toBeTruthy();
    execFileSync('git', ['-C', dir, 'checkout', ws!.replace('origin/', '')]);
    return { dir, content: join(dir, 'content') };
  }

  /** 读某节点恢复后的正文:取它最新 snapshot 的 bodyMarkdown(无则空串)。 */
  async function recoveredBody(ci: string): Promise<string> {
    const snaps = await ctx.app
      .get(ContentSnapshotRepository)
      .listByContentItemId(ci);
    if (snaps.length === 0) return '';
    // listByContentItemId 按时间倒序(最新在前)
    return snaps[0].bodyMarkdown ?? '';
  }

  // ── 场景 A:文件夹自带正文 + 子节点,远端往返 ──────────────────────────

  it('A. 文件夹的正文与子节点正文都穿越远端往返,且恢复后父子结构还原', async () => {
    const F_BODY = '父文件夹自己的正文 αλφα 必须穿越往返';
    const C_BODY = '子节点的正文 βητα 必须穿越往返';

    // 建:文件夹 F(提交正文)→ 其下子节点 C(提交正文)
    const F = await createNode('A场景父文件夹');
    await commitBodyAndAwaitArchive(F.ci, `# F\n\n${F_BODY}`, 'A场景父文件夹');
    const C = await createNode('A场景子节点', F.nodeId);
    await commitBodyAndAwaitArchive(C.ci, `# C\n\n${C_BODY}`, 'A场景子节点');

    await publishAndPush();

    // clone 验:两个 main.md 都在远端,且清单把 C 嵌在 F 之下、F 标为 FOLDER
    const clone = await cloneRemoteWorkspace();
    expect(
      await readFile(join(clone.content, F.ci, 'main.md'), 'utf8'),
    ).toContain(F_BODY);
    expect(
      await readFile(join(clone.content, C.ci, 'main.md'), 'utf8'),
    ).toContain(C_BODY);
    const manifest = yaml.load(
      await readFile(join(clone.dir, '.liminal-field.yaml'), 'utf8'),
    ) as { navigation: Record<string, Array<Record<string, unknown>>> };
    const fNode = manifest.navigation.notes.find(
      (n) => n.contentItemId === F.ci,
    ) as
      | { type: string; children?: Array<{ contentItemId: string }> }
      | undefined;
    expect(fNode?.type).toBe('FOLDER');
    expect(fNode?.children?.some((c) => c.contentItemId === C.ci)).toBe(true);
    await rm(clone.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

    // 灾难 → 恢复
    await wipeMongoAndSync();

    // 断言:两段正文都回来了
    expect(await recoveredBody(F.ci)).toContain(F_BODY);
    expect(await recoveredBody(C.ci)).toContain(C_BODY);

    // 断言:树结构还原——C 的恢复节点挂在 F 的恢复节点之下
    const navRepo = ctx.app.get(NavigationRepository);
    const fNav = await navRepo.findByContentItemId(F.ci);
    const cNav = await navRepo.findByContentItemId(C.ci);
    expect(fNav).toBeTruthy();
    expect(cNav).toBeTruthy();
    expect(cNav!.parentId?.toString()).toBe(fNav!._id.toString());

    // 断言:恢复后均未发布(发布态不进 Git)
    const repo = ctx.app.get(ContentRepository);
    expect((await repo.findById(F.ci))?.publishedVersion ?? null).toBeNull();
    expect((await repo.findById(C.ci))?.publishedVersion ?? null).toBeNull();

    // 断言:F 自身详情可读(文件夹也是一篇笔记),正文回来。
    // visibility=all 模拟管理端读取——恢复后内容未发布,公开视图会 404,管理端才看得到。
    const fDetail = await supertest(server)
      .get(`/api/v1/spaces/notes/items/${F.ci}?visibility=all`)
      .set('Cookie', cookie)
      .expect(200);
    expect(fDetail.body.data.bodyMarkdown).toContain(F_BODY);
  }, 180_000);

  // ── 场景 B:三层嵌套结构还原 ──────────────────────────────────────────

  it('B. 三层嵌套(A>B>C)各自正文存活,父链完整还原', async () => {
    const bodies = {
      a: '三层-顶层A正文 γ',
      b: '三层-中层B正文 δ',
      c: '三层-叶层C正文 ε',
    };
    const a = await createNode('三层顶A');
    await commitBodyAndAwaitArchive(a.ci, `# A\n\n${bodies.a}`, '三层顶A');
    const b = await createNode('三层中B', a.nodeId);
    await commitBodyAndAwaitArchive(b.ci, `# B\n\n${bodies.b}`, '三层中B');
    const c = await createNode('三层叶C', b.nodeId);
    await commitBodyAndAwaitArchive(c.ci, `# C\n\n${bodies.c}`, '三层叶C');

    await publishAndPush();
    await wipeMongoAndSync();

    // 三段正文各自存活
    expect(await recoveredBody(a.ci)).toContain(bodies.a);
    expect(await recoveredBody(b.ci)).toContain(bodies.b);
    expect(await recoveredBody(c.ci)).toContain(bodies.c);

    // 父链:C→B→A 完整还原
    const navRepo = ctx.app.get(NavigationRepository);
    const aNav = await navRepo.findByContentItemId(a.ci);
    const bNav = await navRepo.findByContentItemId(b.ci);
    const cNav = await navRepo.findByContentItemId(c.ci);
    expect(aNav!.parentId ?? null).toBeNull(); // 顶层无父
    expect(bNav!.parentId?.toString()).toBe(aNav!._id.toString());
    expect(cNav!.parentId?.toString()).toBe(bNav!._id.toString());
  }, 180_000);

  // ── 场景 C:文件夹有子节点但正文从未提交(悬挂节点假设) ────────────────

  it('C. 文件夹正文从未提交时,恢复后该文件夹仍可解析、子节点可达,不留悬挂死节点', async () => {
    const C_BODY = '悬挂场景-子节点正文 ζ';

    // 文件夹 F:只创建(后端 mint 空 ContentItem,无 Git commit)→ 子节点 C(提交正文)
    const F = await createNode('C场景空壳文件夹');
    const C = await createNode('C场景子节点', F.nodeId);
    await commitBodyAndAwaitArchive(C.ci, `# C\n\n${C_BODY}`, 'C场景子节点');

    // push(F 无正文 → publish-all 跳过它;只为把 C + 清单推上去)
    await publishAndPush();

    // clone 验:F 在 Git 里【没有目录】(从未提交),C 有;清单仍记录 F(含子 C)
    const clone = await cloneRemoteWorkspace();
    expect(existsSync(join(clone.content, F.ci))).toBe(false);
    expect(existsSync(join(clone.content, C.ci))).toBe(true);
    const manifest = yaml.load(
      await readFile(join(clone.dir, '.liminal-field.yaml'), 'utf8'),
    ) as { navigation: Record<string, Array<Record<string, unknown>>> };
    const fNode = manifest.navigation.notes.find(
      (n) => n.name === 'C场景空壳文件夹',
    ) as { children?: Array<{ contentItemId: string }> } | undefined;
    expect(fNode?.children?.some((c) => c.contentItemId === C.ci)).toBe(true);
    await rm(clone.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });

    // 灾难 → 恢复
    await wipeMongoAndSync();

    // 子节点 C 恢复且正文在
    const navRepo = ctx.app.get(NavigationRepository);
    const cNav = await navRepo.findByContentItemId(C.ci);
    expect(cNav).toBeTruthy();
    expect(await recoveredBody(C.ci)).toContain(C_BODY);

    // 文件夹 F:经 C 的父指针定位(恢复后 F 的 contentItemId 可能被重新 mint,故不按原 ci 找)
    expect(cNav!.parentId).toBeTruthy();
    const fNav = await navRepo.findById(cNav!.parentId!.toString());
    expect(fNav).toBeTruthy();
    expect(fNav!.name).toBe('C场景空壳文件夹');
    expect(fNav!.contentItemId).toBeTruthy(); // 必须挂着一个真实存在的 ContentItem

    // 关键:F 详情可读(200)——不能是指向不存在 ContentItem 的悬挂死节点。
    // visibility=all 走管理端视图(恢复后未发布);空壳文件夹正文为空但必须可读。
    await supertest(server)
      .get(`/api/v1/spaces/notes/items/${fNav!.contentItemId}?visibility=all`)
      .set('Cookie', cookie)
      .expect(200);
  }, 180_000);
});
