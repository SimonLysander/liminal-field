/**
 * anthology-archive-recovery.e2e-spec.ts — 文集条目「归档 → 恢复」全流程回归。
 *
 * 守护的 bug(2026-05-23 修复):
 *   `archiveToGit` 曾硬编码只写 main.md、无视 snapshot.fileName,且 saveContent 提交分支
 *   用 `if (!isSubFile)` 跳过子文件归档 → 文集条目正文(entries/*.md)从不写进 Git →
 *   恢复时读不到磁盘文件 → 正文永久丢失。
 *
 * 两条断言各守一段链路:
 * 1. 主路径立即归档:saveEntry 后【不调 retryPendingArchives 兜底】,断言条目正文
 *    被 fire-and-forget 的 archiveToGit 写进 Git 工作树并提交。这一条专门守 P2 主路径
 *    修复——回退 P2 后文件永不出现,本断言会超时变红(已实测对照)。
 * 2. 完整往返:写 manifest → 清空 Mongo → 从 Git recovery,断言条目正文穿越后存活。
 *    覆盖 manifest scope 判定 + recoverAnthologyEntries 读盘重建(无 manifest 会把
 *    anthology 误判为 notes、跳过条目,即历史"恢复丢结构"的另一面)。
 *
 * 隔离性:沿用 helpers 的 MongoMemoryServer(内存库)+ 临时 Git 仓,绝不触碰真实数据。
 */
import supertest from 'supertest';
import { readFile } from 'fs/promises';
import { join } from 'path';
import simpleGit from 'simple-git';
import {
  TestContext,
  login,
  createAnthologyItem,
  addAnthologyEntry,
} from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { ContentGitService } from '../src/modules/content/content-git.service';
import { ManifestService } from '../src/modules/settings/manifest.service';
import { RecoveryService } from '../src/modules/settings/recovery.service';
import { ContentRepository } from '../src/modules/content/content.repository';
import { ContentSnapshotRepository } from '../src/modules/content/content-snapshot.repository';
import { NavigationRepository } from '../src/modules/navigation/navigation.repository';
import { AnthologyViewService } from '../src/modules/workspace/anthology-view.service';

const MARKER = '这段条目正文必须穿越归档与恢复存活下来';
const BODY = `# 关于主体\n\n${MARKER}。`;

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

  it('主路径立即把条目正文归档进 Git entries/*.md,且清空 Mongo 后能从 Git 完整恢复', async () => {
    // ── 1. 建文集 + 加条目(带正文)── 走真实 addEntry + saveEntry
    const anthologyId = await createAnthologyItem(
      ctx.app,
      cookie,
      '归档恢复测试文集',
    );
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, anthologyId, {
      title: '关于主体与自我',
      bodyMarkdown: BODY,
    });

    // ── 2. 断言【主路径归档】:不调 retryPendingArchives 兜底,直接等 fire-and-forget
    //        的 archiveToGit 把 entries/<key>.md 写盘。这一步专门守 P2 主路径修复。
    const entryRelPath = `content/${anthologyId}/entries/${entryKey}.md`;
    const entryAbsPath = join(ctx.tmpGitDir, entryRelPath);
    const diskContent = await waitForFileContaining(entryAbsPath, MARKER);
    expect(diskContent).not.toBeNull(); // null = 主路径没归档(P2 退化)

    // 且已被 git 跟踪(写盘 + commit 都完成,而非仅留在工作树未提交)
    const git = simpleGit(ctx.tmpGitDir);
    const tracked = (await git.raw(['ls-files', entryRelPath])).trim();
    expect(tracked).toBe(entryRelPath);

    // ── 3. 写 manifest(恢复据此判 scope=anthology 才会扫 entries/)+ 提交 ──
    const gitSvc = ctx.app.get(ContentGitService);
    await ctx.app.get(ManifestService).writeManifest();
    await gitSvc.commitManifestIfChanged();

    // ── 4. 模拟灾难:清空 Mongo(Git 仓作为冷归档幸存)──
    await ctx.app.get(ContentRepository).deleteAll();
    await ctx.app.get(ContentSnapshotRepository).deleteAll();
    await ctx.app.get(NavigationRepository).deleteAll();

    // ── 5. 从 Git 恢复(等同 sync-from-remote 的 scan + execute)──
    const recovery = ctx.app.get(RecoveryService);
    const scan = await recovery.scan();
    expect(scan.missingInDb).toContain(anthologyId);

    const exec = await recovery.execute(scan.missingInDb);
    expect(exec.errors).toEqual([]);
    expect(exec.recovered).toBeGreaterThan(0);

    // ── 6. 断言【恢复】:条目正文回来了(经管理端详情读取,走完整 DTO 组装)──
    const detailRes = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/spaces/anthology/items/${anthologyId}/entries/${entryKey}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(detailRes.body.data.bodyMarkdown).toContain(MARKER);
  });

  it('条目发布状态只存 Mongo、不写进 Git main.md,恢复后重置为未发布', async () => {
    const anthologyId = await createAnthologyItem(
      ctx.app,
      cookie,
      '发布状态测试文集',
    );
    const { entryKey } = await addAnthologyEntry(ctx.app, cookie, anthologyId, {
      title: '会被发布的条目',
      bodyMarkdown: '正文内容',
    });

    // 发布条目 + 整集上线
    await supertest(ctx.app.getHttpServer())
      .put(
        `/api/v1/spaces/anthology/items/${anthologyId}/entries/${entryKey}/publish`,
      )
      .set('Cookie', cookie)
      .expect(200);
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/anthology/items/${anthologyId}/publish`)
      .set('Cookie', cookie)
      .expect(200);

    const anthologySvc = ctx.app.get(AnthologyViewService);
    const contentRepo = ctx.app.get(ContentRepository);

    // 发布生效:发布状态落在 Mongo ContentItem.entryPublishStates
    const itemAfterPublish = await contentRepo.findById(anthologyId);
    expect(itemAfterPublish?.entryPublishStates?.length).toBe(1);
    const adminAfter = await anthologySvc.toAdminDetail(anthologyId);
    expect(adminAfter.entries[0].publishedVersionId).not.toBeNull();

    // flush Git + manifest,断言 main.md(进 Git 的文件)里【不含】publishedVersionId
    const gitSvc = ctx.app.get(ContentGitService);
    await gitSvc.retryPendingArchives();
    await ctx.app.get(ManifestService).writeManifest();
    await gitSvc.commitManifestIfChanged();
    const mainMd = await readFile(
      join(ctx.tmpGitDir, 'content', anthologyId, 'main.md'),
      'utf8',
    );
    expect(mainMd).toContain(entryKey); // 结构(条目)在
    expect(mainMd).not.toContain('publishedVersionId'); // 发布状态不在 Git

    // 清空 Mongo → 从 Git 恢复
    await contentRepo.deleteAll();
    await ctx.app.get(ContentSnapshotRepository).deleteAll();
    await ctx.app.get(NavigationRepository).deleteAll();
    const recovery = ctx.app.get(RecoveryService);
    await recovery.execute((await recovery.scan()).missingInDb);

    // 恢复后:条目结构回来了,但发布状态被重置为未发布(需手动重发)
    const itemAfterRecover = await contentRepo.findById(anthologyId);
    expect(itemAfterRecover?.entryPublishStates ?? []).toHaveLength(0);
    const adminAfterRecover = await anthologySvc.toAdminDetail(anthologyId);
    expect(adminAfterRecover.entries).toHaveLength(1); // 条目还在
    expect(adminAfterRecover.entries[0].publishedVersionId).toBeNull(); // 但未发布
  });
});
