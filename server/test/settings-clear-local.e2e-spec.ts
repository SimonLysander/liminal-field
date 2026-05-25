/**
 * settings-clear-local.e2e-spec.ts — 「清空本地」补清回归。
 *
 * 守护的 bug:clear-local 历史上只删 content/snapshot/navigation,漏删 editor_drafts(草稿),
 * 内容删了草稿成孤儿 → 下次撞 id 读到幽灵草稿。本用例断言 clear-local 连带清掉:
 * - 草稿(全部)
 * - session 类 Lux 记忆(绑定草稿,内容没了即孤儿)
 * 同时【保留】user 类记忆(所有者画像,与具体内容无关,不应随内容清空被抹)。
 */
import supertest from 'supertest';
import { Types } from 'mongoose';
import { getModelToken } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
import { TestContext, login, createNoteItem } from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';
import { ContentRepository } from '../src/modules/content/content.repository';
import { EditorDraft } from '../src/modules/workspace/editor-draft.entity';
import { AgentMemory } from '../src/modules/agent/memory/agent-memory.entity';

describe('清空本地 clear-local 补清 (e2e regression)', () => {
  let ctx: TestContext;
  let cookie: string;
  let draftModel: ReturnModelType<typeof EditorDraft>;
  let memoryModel: ReturnModelType<typeof AgentMemory>;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([SettingsModule]);
    cookie = await login(ctx.app);
    draftModel = ctx.app.get(getModelToken('EditorDraft'));
    memoryModel = ctx.app.get(getModelToken('AgentMemory'));
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  it('清内容时连带清草稿 + session 记忆,保留 user 画像', async () => {
    // ── 建内容 + 播种草稿、user 记忆、session 记忆 ──
    const noteId = await createNoteItem(ctx.app, cookie, '待清笔记');
    await draftModel.create({
      _id: `draft:${noteId}`,
      contentItemId: noteId,
      bodyMarkdown: 'WIP 草稿正文',
      title: '待清笔记',
      changeNote: '草稿',
      savedAt: new Date(),
    });
    const now = new Date();
    await memoryModel.create({
      _id: new Types.ObjectId(),
      type: 'user',
      title: '所有者画像',
      content: '偏好简洁克制的表达',
      createdAt: now,
      updatedAt: now,
    });
    await memoryModel.create({
      _id: new Types.ObjectId(),
      type: 'session',
      agentKey: `draft:${noteId}`,
      title: `session:draft:${noteId}`,
      content: '写到第三章,待补论证',
      tasks: [],
      createdAt: now,
      updatedAt: now,
    });

    // 播种确认
    expect(await draftModel.countDocuments({})).toBe(1);
    expect(await memoryModel.countDocuments({})).toBe(2);

    // ── 清空本地 ──
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/settings/clear-local')
      .set('Cookie', cookie)
      .send({})
      .expect(201);

    // ── 断言:内容 / 草稿 / session 记忆清空,user 画像保留 ──
    expect(await ctx.app.get(ContentRepository).countAll()).toBe(0);
    expect(await draftModel.countDocuments({})).toBe(0); // 草稿清(以前漏清,本断言守住)
    expect(await memoryModel.countDocuments({ type: 'session' })).toBe(0);
    expect(await memoryModel.countDocuments({ type: 'user' })).toBe(1); // 画像保留
  });
});
