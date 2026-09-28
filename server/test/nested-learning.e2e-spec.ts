import supertest from 'supertest';
import type { StructureNodeDto } from '../src/modules/navigation/dto/structure-node.dto';
import type {
  LearningProjectDto,
  LearningProjectResolveDto,
  LearningProjectDiscardDto,
} from '../src/modules/learning/dto/learning-project.dto';
import { StructureModule } from '../src/modules/structure/structure.module';
import { EditorDraftRepository } from '../src/modules/workspace/editor-draft.repository';
import { PendingWriteRepository } from '../src/modules/agent/approval/pending-write.repository';
import { TestContext, login } from './helpers';

describe('Nested learning projects (e2e)', () => {
  const ctx = new TestContext();
  let cookie: string;
  let drafts: EditorDraftRepository;

  beforeAll(async () => {
    await ctx.setup([StructureModule]);
    cookie = await login(ctx.app);
    drafts = ctx.app.get(EditorDraftRepository);
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  async function createNode(
    name: string,
    parentId?: string,
  ): Promise<StructureNodeDto> {
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/structure-nodes')
      .set('Cookie', cookie)
      .send({ name, scope: 'notes', parentId })
      .expect(201);
    return (res.body as { data: StructureNodeDto }).data;
  }

  async function start(rootNodeId: string): Promise<LearningProjectDto> {
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/learning/projects')
      .set('Cookie', cookie)
      .send({ rootNodeId })
      .expect(201);
    return (res.body as { data: LearningProjectDto }).data;
  }

  async function resolve(nodeId: string): Promise<LearningProjectResolveDto> {
    const res = await supertest(ctx.app.getHttpServer())
      .get('/api/v1/learning/projects/resolve')
      .set('Cookie', cookie)
      .query({ nodeId })
      .expect(200);
    return (res.body as { data: LearningProjectResolveDto }).data;
  }

  async function saveAi(contentItemId: string, text: string) {
    await drafts.saveAiDraft({
      contentItemId,
      bodyMarkdown: text,
      title: text,
      summary: '',
      changeNote: '',
      savedAt: new Date(),
    });
  }

  it('starts a parent after a child and preserves independent child drafts when the parent is discarded', async () => {
    const parent = await createNode('上级');
    const child = await createNode('独立子级', parent.id);
    const leaf = await createNode('子级篇目', child.id);
    const sibling = await createNode('普通篇目', parent.id);
    const childProject = await start(child.id);
    expect((await resolve(parent.id)).canStart).toBe(true);
    const parentProject = await start(parent.id);

    expect((await resolve(child.id)).project?.id).toBe(childProject.id);
    expect((await resolve(leaf.id)).project?.id).toBe(childProject.id);
    expect((await resolve(sibling.id)).project?.id).toBe(parentProject.id);
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/learning/projects')
      .set('Cookie', cookie)
      .send({ rootNodeId: parent.id })
      .expect(400);

    for (const page of [parent, child, leaf, sibling]) {
      await saveAi(page.contentItemId!, page.name);
    }
    await drafts.save({
      contentItemId: parent.contentItemId!,
      bodyMarkdown: '我的正文',
      title: '我的标题',
      summary: '',
      changeNote: '',
      savedAt: new Date(),
    });
    const res = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/learning/projects/${parentProject.id}/discard`)
      .set('Cookie', cookie)
      .expect(201);
    const result = (res.body as { data: LearningProjectDiscardDto }).data;

    expect(result.affectedContentItemIds.sort()).toEqual(
      [parent.contentItemId, sibling.contentItemId].sort(),
    );
    expect(result.deleted).toBe(2);
    expect(
      await drafts.findAiDraftByContentItemId(parent.contentItemId!),
    ).toBeNull();
    expect(
      (await drafts.findAiDraftByContentItemId(child.contentItemId!))
        ?.bodyMarkdown,
    ).toBe(child.name);
    expect(
      (await drafts.findAiDraftByContentItemId(leaf.contentItemId!))
        ?.bodyMarkdown,
    ).toBe(leaf.name);
    expect(
      (await drafts.findByContentItemId(parent.contentItemId!))?.bodyMarkdown,
    ).toBe('我的正文');
    expect((await resolve(parent.id)).canStart).toBe(true);
    expect((await resolve(leaf.id)).project?.id).toBe(childProject.id);
  });

  it('moves an independent project below another while keeping its own ownership and cycle protection', async () => {
    const parent = await createNode('移动目标');
    const child = await createNode('独立主题');
    const leaf = await createNode('主题篇目', child.id);
    await start(parent.id);
    const childProject = await start(child.id);
    await saveAi(leaf.contentItemId!, '已写内容');

    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/structure-nodes/${child.id}`)
      .set('Cookie', cookie)
      .send({ parentId: parent.id })
      .expect(200);
    expect((await resolve(leaf.id)).project?.id).toBe(childProject.id);
    expect(
      (await drafts.findAiDraftByContentItemId(leaf.contentItemId!))
        ?.bodyMarkdown,
    ).toBe('已写内容');
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/structure-nodes/${parent.id}`)
      .set('Cookie', cookie)
      .send({ parentId: leaf.id })
      .expect(400);
    await supertest(ctx.app.getHttpServer())
      .delete(`/api/v1/structure-nodes/${child.id}`)
      .set('Cookie', cookie)
      .expect(400);
  });

  it('rejects an old writer approval when the page becomes a planning root', async () => {
    const parent = await createNode('审批上级');
    const child = await createNode('审批子级', parent.id);
    await start(parent.id);
    await saveAi(child.contentItemId!, '待保留内容');
    const pending = ctx.app.get(PendingWriteRepository);
    await pending.stash({
      toolCallId: 'stale-nested-write',
      sessionKey: 'learn-child',
      toolName: 'write_draft',
      targetContentItemId: child.contentItemId!,
      payload: { markdown: '不应写入的正文', changeSummary: '改写正文' },
      now: new Date(),
    });
    await start(child.id);

    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/agent/writes/stale-nested-write/approve')
      .set('Cookie', cookie)
      .send({ sessionKey: 'learn-child' })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('学习归属已变化');
    expect(
      (await drafts.findAiDraftByContentItemId(child.contentItemId!))
        ?.bodyMarkdown,
    ).toBe('待保留内容');
    expect((await pending.findById('stale-nested-write'))?.status).toBe(
      'pending',
    );
  });
});
