/**
 * anthology-archive-recovery.e2e-spec.ts — 文集容器+条目「归档 → 恢复」全流程回归。
 *
 * 统一页面树 Phase 1 重构后(2026-05-31):
 * - 文集容器和条目都是独立的 ContentItem,各自的 main.md 都得归档进 Git。
 * - 容器节点 main.md 同时承载 title/description frontmatter + 可选卷首语 body。
 * - 子节点(原 entry)正文写在它自己的 content/<nodeId>/main.md。
 *
 * 三条断言:
 * 1. 主路径立即归档:子节点正文被 fire-and-forget 的 archiveToGit 写盘 + git 跟踪。
 * 2. 容器卷首语归档:容器节点 saveContent 后,卷首语进容器 main.md。
 * 3. 完整往返:写 manifest → 清空 Mongo → 从 Git recovery,
 *    断言容器+卷首语+子节点正文穿越后存活;发布状态不进 Git。
 *
 * 隔离性:沿用 helpers 的 MongoMemoryServer + 临时 Git 仓,绝不触碰真实数据。
 */
import supertest from 'supertest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import simpleGit from 'simple-git';
import {
  TestContext,
  login,
  createAnthologyItem,
  createAnthologyChildNode,
} from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { ContentGitService } from '../src/modules/content/content-git.service';
import { ManifestService } from '../src/modules/settings/manifest.service';
import { RecoveryService } from '../src/modules/settings/recovery.service';
import { ContentRepository } from '../src/modules/content/content.repository';
import { ContentSnapshotRepository } from '../src/modules/content/content-snapshot.repository';
import { NavigationRepository } from '../src/modules/navigation/navigation.repository';
import { AnthologyViewService } from '../src/modules/workspace/anthology-view.service';

const ENTRY_MARKER = '条目正文必须穿越归档与恢复存活下来';
const ENTRY_BODY = `# 关于主体\n\n${ENTRY_MARKER}。`;
const PREFACE_MARKER = '卷首语也必须穿越归档与恢复';
const PREFACE_BODY = `${PREFACE_MARKER}\n\n这是容器自身的正文。`;

/**
 * 轮询等待磁盘文件出现且包含期望内容。
 * 用于等待 fire-and-forget 的 archiveToGit 完成(它无可 await 的句柄),
 * 超时即视为"主路径没归档"——也就是要守的 bug 复现。
 */
async function waitForFileContaining(
  filePath: string,
  needle: string,
  timeoutMs = 8000,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = await readFile(filePath, 'utf8');
      if (content.includes(needle)) return content;
    } catch {
      // 文件还没出现,继续等
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}

describe('Anthology 归档 → 恢复 全流程 (e2e regression)', () => {
  let ctx: TestContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([SettingsModule]); // 仅本套件需要 RecoveryService / ManifestService
    cookie = await login(ctx.app);
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('主路径把子节点正文 + 容器卷首语都归档,清空 Mongo 后能从 Git 完整恢复', async () => {
    // ── 1. 建文集 + 加子节点(带正文)── 走 Phase 1 后的通用节点接口
    const anthologyId = await createAnthologyItem(
      ctx.app,
      cookie,
      '归档恢复测试文集',
    );
    const nodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      anthologyId,
      '关于主体与自我',
      ENTRY_BODY,
    );

    // ── 2. 同时给容器节点加卷首语(走通用 :scope/items/:id PUT)──
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${anthologyId}`)
      .set('Cookie', cookie)
      .send({
        title: '归档恢复测试文集',
        bodyMarkdown: PREFACE_BODY,
        changeNote: '写卷首语',
      })
      .expect(200);

    // ── 3. 断言【主路径归档】:子节点正文进它自己的 content/<nodeId>/main.md
    const entryRelPath = `content/${nodeId}/main.md`;
    const entryAbsPath = join(ctx.tmpGitDir, entryRelPath);
    const diskContent = await waitForFileContaining(entryAbsPath, ENTRY_MARKER);
    expect(diskContent).not.toBeNull(); // null = 主路径没归档(P2 退化)

    // 且已被 git 跟踪(归档 commit 是 fire-and-forget + writeLock 串行,轮询等待)
    const git = simpleGit(ctx.tmpGitDir);
    let tracked = '';
    for (let i = 0; i < 40; i++) {
      tracked = (await git.raw(['ls-files', entryRelPath])).trim();
      if (tracked === entryRelPath) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(tracked).toBe(entryRelPath);

    // ── 4. 断言【容器卷首语归档】 ──
    const anthologyMainPath = join(
      ctx.tmpGitDir,
      'content',
      anthologyId,
      'main.md',
    );
    const anthologyDisk = await waitForFileContaining(
      anthologyMainPath,
      PREFACE_MARKER,
    );
    expect(anthologyDisk).not.toBeNull();

    // ── 5. 写 manifest(恢复据此判 scope=anthology 才会扫子节点)+ 提交 ──
    const gitSvc = ctx.app.get(ContentGitService);
    await ctx.app.get(ManifestService).writeManifest();
    await gitSvc.commitManifestIfChanged();

    // ── 6. 模拟灾难:清空 Mongo(Git 仓作为冷归档幸存)──
    await ctx.app.get(ContentRepository).deleteAll();
    await ctx.app.get(ContentSnapshotRepository).deleteAll();
    await ctx.app.get(NavigationRepository).deleteAll();

    // ── 7. 从 Git 恢复 ──
    const recovery = ctx.app.get(RecoveryService);
    const scan = await recovery.scan();
    expect(scan.missingInDb).toContain(anthologyId);

    const exec = await recovery.execute(scan.missingInDb);
    expect(exec.errors).toEqual([]);
    expect(exec.recovered).toBeGreaterThan(0);

    // ── 8. 断言【恢复】:容器+卷首语+子节点正文都回来了 ──
    // 容器卷首语通过管理端详情访问(toAdminDetail 返回 bodyMarkdown)
    const containerRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/items/${anthologyId}?visibility=all`)
      .set('Cookie', cookie)
      .expect(200);
    expect(containerRes.body.data.bodyMarkdown).toContain(PREFACE_MARKER);
    expect(containerRes.body.data.entries).toHaveLength(1);
    expect(containerRes.body.data.entries[0].key).toBe(nodeId);
    // 子节点正文通过阅读端路由(带 cookie = 管理端语义,读最新)
    const entryRes = await supertest(ctx.app.getHttpServer())
      .get(
        `/api/v1/spaces/anthology/public/items/${anthologyId}/entries/${nodeId}`,
      )
      .set('Cookie', cookie)
      .expect(200);
    expect(entryRes.body.data.bodyMarkdown).toContain(ENTRY_MARKER);
  });

  it('条目发布状态(子 ContentItem.publishedVersion)不进 Git,恢复后重置为未发布', async () => {
    const anthologyId = await createAnthologyItem(
      ctx.app,
      cookie,
      '发布状态测试文集',
    );
    const nodeId = await createAnthologyChildNode(
      ctx.app,
      cookie,
      anthologyId,
      '会被发布的条目',
      '正文内容',
    );

    // 发布顺序:文集先上线,再发布条目(Phase 1 后子节点发布走通用 :scope/items/:id/publish)
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${anthologyId}/publish`)
      .set('Cookie', cookie)
      .expect(200);
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${nodeId}/publish`)
      .set('Cookie', cookie)
      .expect(200);

    const anthologySvc = ctx.app.get(AnthologyViewService);
    const contentRepo = ctx.app.get(ContentRepository);

    // 发布生效:发布状态落在条目子 ContentItem(nodeId 即其 id)的 publishedVersion
    expect((await contentRepo.findById(nodeId))?.publishedVersion).toBeTruthy();
    const adminAfter = await anthologySvc.toAdminDetail(anthologyId);
    expect(adminAfter.status).toBe('published');

    // flush Git + manifest,断言条目子 ContentItem 的 main.md 里【不含】publishedVersionId
    const gitSvc = ctx.app.get(ContentGitService);
    await gitSvc.retryPendingArchives();
    await ctx.app.get(ManifestService).writeManifest();
    await gitSvc.commitManifestIfChanged();
    const entryMainMd = await readFile(
      join(ctx.tmpGitDir, 'content', nodeId, 'main.md'),
      'utf8',
    );
    expect(entryMainMd).not.toContain('publishedVersionId'); // 发布状态不在 Git

    // 清空 Mongo → 从 Git 恢复
    await contentRepo.deleteAll();
    await ctx.app.get(ContentSnapshotRepository).deleteAll();
    await ctx.app.get(NavigationRepository).deleteAll();
    const recovery = ctx.app.get(RecoveryService);
    await recovery.execute((await recovery.scan()).missingInDb);

    // 恢复后:条目结构回来了,但发布状态被重置为未发布(需手动重发)
    expect(
      (await contentRepo.findById(nodeId))?.publishedVersion ?? null,
    ).toBeNull();
    const adminAfterRecover = await anthologySvc.toAdminDetail(anthologyId);
    expect(adminAfterRecover.entries).toHaveLength(1); // 条目还在
    expect(adminAfterRecover.status).toBe('committed'); // 容器未发布
  });
});
