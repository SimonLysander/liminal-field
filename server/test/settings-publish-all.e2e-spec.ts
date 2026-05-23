/**
 * settings-publish-all.e2e-spec.ts — 一键「发布全部最新版」回归。
 *
 * 验证 POST /settings/publish-all 按 scope 把所有内容的最新版上线:
 * - notes:publishedVersion 指向最新
 * - anthology:所有有内容条目进 entryPublishStates + 整集 publishedVersion 上线
 * 这是发布状态迁出 Git 后,灾后/恢复后一键重新上线的手段(替代逐条手动发布)。
 */
import supertest from 'supertest';
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

describe('一键发布全部最新版 publish-all (e2e)', () => {
  let ctx: TestContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([SettingsModule]);
    cookie = await login(ctx.app);
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('把笔记与文集(含条目)的最新版一键上线', async () => {
    // 笔记:建 + 提交内容
    const noteId = await createNoteItem(ctx.app, cookie, '待发布笔记');
    await commitNoteContent(ctx.app, cookie, noteId, '# 正文', '待发布笔记');

    // 文集:建 + 加一条带正文的条目
    const anthologyId = await createAnthologyItem(ctx.app, cookie, '待发布文集');
    await addAnthologyEntry(ctx.app, cookie, anthologyId, {
      title: '条目一',
      bodyMarkdown: '条目正文',
    });

    const contentRepo = ctx.app.get(ContentRepository);
    // 初始都未发布
    expect((await contentRepo.findById(noteId))?.publishedVersion ?? null).toBeNull();
    expect((await contentRepo.findById(anthologyId))?.publishedVersion ?? null).toBeNull();

    // 一键发布全部
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/settings/publish-all')
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body.data.published).toBeGreaterThanOrEqual(2);

    // 笔记已上线
    const note = await contentRepo.findById(noteId);
    expect(note?.publishedVersion).toBeTruthy();

    // 文集已上线 + 条目进了发布状态
    const anthology = await contentRepo.findById(anthologyId);
    expect(anthology?.publishedVersion).toBeTruthy();
    expect(anthology?.entryPublishStates?.length).toBe(1);
  });
});
