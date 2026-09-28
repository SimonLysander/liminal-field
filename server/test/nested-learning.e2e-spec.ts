import supertest from 'supertest';
import type { StructureNodeDto } from '../src/modules/navigation/dto/structure-node.dto';
import type {
  LearningProjectDto,
  LearningProjectResolveDto,
  LearningProjectDiscardDto,
  LearningProjectOutlineDto,
} from '../src/modules/learning/dto/learning-project.dto';
import { StructureModule } from '../src/modules/structure/structure.module';
import { EditorDraftRepository } from '../src/modules/workspace/editor-draft.repository';
import { PendingWriteRepository } from '../src/modules/agent/approval/pending-write.repository';
import { LearningProjectRepository } from '../src/modules/learning/learning-project.repository';
import { NavigationRepository } from '../src/modules/navigation/navigation.repository';
import { TestContext, login, commitNoteContent } from './helpers';

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
      .expect(200);
    expect(
      (await ctx.app.get(LearningProjectRepository).findById(childProject.id))
        ?.status,
    ).toBe('archived');
    expect((await resolve(parent.id)).project?.rootNodeId).toBe(parent.id);
  });

  it('deletes an ordinary child without ending its parent learning or changing sibling drafts', async () => {
    const parent = await createNode('普通删除父级');
    const child = await createNode('普通删除子级', parent.id);
    const leaf = await createNode('普通删除叶子', child.id);
    const sibling = await createNode('保留兄弟', parent.id);
    const project = await start(parent.id);
    await saveAi(sibling.contentItemId!, '保留初稿');
    await supertest(ctx.app.getHttpServer())
      .delete(`/api/v1/structure-nodes/${child.id}`)
      .set('Cookie', cookie)
      .expect(200);
    expect((await resolve(sibling.id)).project?.id).toBe(project.id);
    expect(
      (await drafts.findAiDraftByContentItemId(sibling.contentItemId!))
        ?.bodyMarkdown,
    ).toBe('保留初稿');
    await supertest(ctx.app.getHttpServer())
      .get('/api/v1/learning/projects/resolve')
      .query({ nodeId: leaf.id })
      .set('Cookie', cookie)
      .expect(404);
  });

  it('ends every learning project inside a deleted subtree while leaving outside learning active', async () => {
    const parent = await createNode('范围删除父级');
    const child = await createNode('范围删除子级', parent.id);
    const nested = await createNode('范围删除独立后代', child.id);
    const sibling = await createNode('范围外独立学习', parent.id);
    const parentProject = await start(parent.id);
    const childProject = await start(child.id);
    const nestedProject = await start(nested.id);
    const siblingProject = await start(sibling.id);
    await supertest(ctx.app.getHttpServer())
      .delete(`/api/v1/structure-nodes/${child.id}`)
      .set('Cookie', cookie)
      .expect(200);
    const repository = ctx.app.get(LearningProjectRepository);
    for (const project of [childProject, nestedProject]) {
      expect((await repository.findById(project.id))?.status).toBe('archived');
    }
    for (const project of [parentProject, siblingProject]) {
      expect((await repository.findById(project.id))?.status).toBe('active');
    }
  });

  it('does not archive projects or delete nodes when any descendant is published', async () => {
    const root = await createNode('发布保护学习根');
    const leaf = await createNode('已发布的学习子页', root.id);
    const project = await start(root.id);
    await commitNoteContent(ctx.app, cookie, leaf.contentItemId!);
    await supertest(ctx.app.getHttpServer())
      .put(`/api/v1/spaces/notes/items/${leaf.contentItemId!}/publish`)
      .set('Cookie', cookie)
      .send({})
      .expect(200);
    await supertest(ctx.app.getHttpServer())
      .delete(`/api/v1/structure-nodes/${root.id}`)
      .set('Cookie', cookie)
      .expect(400);
    expect((await resolve(leaf.id)).project?.id).toBe(project.id);
    expect(
      (await ctx.app.get(LearningProjectRepository).findById(project.id))
        ?.status,
    ).toBe('active');
  });

  it('restores learning when the navigation delete fails after projects were archived', async () => {
    const root = await createNode('删除失败恢复学习');
    const project = await start(root.id);
    const remove = jest
      .spyOn(ctx.app.get(NavigationRepository), 'deleteManyByIds')
      .mockRejectedValueOnce(new Error('simulated delete failure'));
    try {
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/structure-nodes/${root.id}`)
        .set('Cookie', cookie)
        .expect(500);
      const restored = await ctx.app
        .get(LearningProjectRepository)
        .findById(project.id);
      expect(restored?.status).toBe('active');
      expect(restored?.archivedAt).toBeUndefined();
      expect((await resolve(root.id)).project?.id).toBe(project.id);
    } finally {
      remove.mockRestore();
    }
  });

  it('keeps ended projects ended when deletion completed but its response failed', async () => {
    const root = await createNode('删除响应丢失');
    const project = await start(root.id);
    const navigation = ctx.app.get(NavigationRepository);
    const originalDelete = navigation.deleteManyByIds.bind(navigation);
    const remove = jest
      .spyOn(navigation, 'deleteManyByIds')
      .mockImplementationOnce(async (ids) => {
        await originalDelete(ids);
        throw new Error('simulated lost response');
      });
    try {
      await supertest(ctx.app.getHttpServer())
        .delete(`/api/v1/structure-nodes/${root.id}`)
        .set('Cookie', cookie)
        .expect(500);
      expect(
        (await ctx.app.get(LearningProjectRepository).findById(project.id))
          ?.status,
      ).toBe('archived');
      expect(await navigation.findById(root.id)).toBeNull();
    } finally {
      remove.mockRestore();
    }
  });

  it('returns an ordered outline with independent roots as entries instead of owned chapters', async () => {
    const root = await createNode('目录学习根');
    const nested = await createNode('独立目录', root.id);
    const owned = await createNode('当前篇目', root.id);
    const ownedLeaf = await createNode('当前子篇', owned.id);
    await createNode('独立子篇不计入', nested.id);
    await start(root.id);
    await start(nested.id);
    const readOutline = async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/learning/projects/outline')
        .set('Cookie', cookie)
        .query({ nodeId: root.id })
        .expect(200);
      return (res.body as { data: LearningProjectOutlineDto }).data;
    };
    expect(
      (await readOutline()).chapters.map((chapter) => [
        chapter.node.id,
        chapter.isIndependentLearningRoot,
      ]),
    ).toEqual([
      [nested.id, true],
      [owned.id, false],
      [ownedLeaf.id, false],
    ]);
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/structure-nodes/reorder')
      .set('Cookie', cookie)
      .send({ parentId: root.id, nodeIds: [owned.id, nested.id] })
      .expect(201);
    expect(
      (await readOutline()).chapters.map((chapter) => chapter.node.id),
    ).toEqual([owned.id, ownedLeaf.id, nested.id]);
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
