import supertest from 'supertest';
import { randomUUID } from 'node:crypto';
import { TestContext, login } from './helpers';
import type { StructureNodeDto } from '../src/modules/navigation/dto/structure-node.dto';
import { EditorDraftRepository } from '../src/modules/workspace/editor-draft.repository';
import { PendingWriteRepository } from '../src/modules/agent/approval/pending-write.repository';
import {
  captureDraftSectionBase,
  commitDraftWrite,
  composeAiDraftBody,
  createWriteDraftTool,
  validateDraftWriteInput,
  type DraftWriteInput,
} from '../src/modules/agent/tools/write-draft.tool';
import { gateWrite } from '../src/modules/agent/approval/gate-write';

describe('Section approvals (HTTP + Mongo)', () => {
  const ctx = new TestContext();
  const original =
    '# 标题\n\n## 甲\n\n甲原文。\n\n### 甲子节\n\n子节原文。\n\n## 乙\n\n乙原文。';
  let cookie: string;
  let drafts: EditorDraftRepository;
  let pending: PendingWriteRepository;
  let targetId: string;
  let sessionKey: string;

  beforeAll(async () => {
    await ctx.setup();
    cookie = await login(ctx.app);
    drafts = ctx.app.get(EditorDraftRepository);
    pending = ctx.app.get(PendingWriteRepository);
  });
  afterAll(async () => ctx.teardown());

  beforeEach(async () => {
    const create = async (name: string, parentId?: string) => {
      const response = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/structure-nodes')
        .set('Cookie', cookie)
        .send({ scope: 'notes', name, parentId })
        .expect(201);
      return (response.body as { data: StructureNodeDto }).data;
    };
    const root = await create(`学习主题-${randomUUID()}`);
    const leaf = await create('正文', root.id);
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/learning/projects')
      .set('Cookie', cookie)
      .send({ rootNodeId: root.id })
      .expect(201);
    targetId = leaf.contentItemId!;
    sessionKey = `learn-${targetId}`;
    await save(original);
  });

  async function save(bodyMarkdown: string) {
    await drafts.saveAiDraft({
      contentItemId: targetId,
      bodyMarkdown,
      title: '标题',
      summary: '',
      changeNote: 'learn-draft',
      savedAt: new Date(),
    });
  }

  function section(title: string, text: string): DraftWriteInput {
    return {
      operation: 'replace_section',
      sectionPath: ['标题', title],
      sectionMarkdown: text,
      sources: [],
      changeSummary: `修改${title}`,
    };
  }

  async function propose(input: DraftWriteInput) {
    const callId = randomUUID();
    const gated = gateWrite(createWriteDraftTool(drafts, targetId), {
      toolName: 'write_draft',
      sessionKey,
      targetContentItemId: targetId,
      pendingWriteRepo: pending,
      validate: validateDraftWriteInput,
      prepare: async (args) => ({
        draftSectionBase: await captureDraftSectionBase(drafts, targetId, args),
      }),
      buildPreview: () => ({}),
    }) as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<string>;
    };
    const result = JSON.parse(
      await gated.execute(input, { toolCallId: callId }),
    ) as { meta: { status: string } };
    expect(result.meta.status).toBe('pending_approval');
    return callId;
  }

  async function approve(callId: string) {
    const response = await supertest(ctx.app.getHttpServer())
      .post(`/api/v1/agent/writes/${callId}/approve`)
      .set('Cookie', cookie)
      .send({ sessionKey })
      .expect(200);
    return (response.body as { data: { status: string } }).data.status;
  }

  async function body() {
    return (await drafts.findAiDraftByContentItemId(targetId))!.bodyMarkdown;
  }

  it('allows independent sections in reverse proposal order and preserves both changes', async () => {
    const first = await propose(section('甲', '甲修改。'));
    const second = await propose(section('乙', '乙修改。'));
    expect(await approve(second)).toBe('ok');
    expect(await approve(first)).toBe('ok');
    expect(await body()).toContain('甲修改。');
    expect(await body()).toContain('乙修改。');
    expect((await pending.findById(first))?.draftSectionBase).toBeUndefined();
  });

  it('rejects overlapping changes to the same section without reverting its newer content', async () => {
    const first = await propose(section('甲', '旧修改。'));
    const second = await propose(section('甲', '新修改。'));
    expect(await approve(second)).toBe('ok');
    expect(await approve(first)).toBe('superseded');
    expect(await body()).toContain('新修改。');
    expect(await body()).not.toContain('旧修改。');
  });

  it.each(['parent-first', 'child-first'])(
    'rejects ancestor/descendant conflicts (%s)',
    async (order) => {
      const parent = await propose(
        section('甲', '甲新文。\n\n### 甲子节\n\n子节更新。'),
      );
      const child = await propose({
        ...section('甲子节', '子节独立更新。'),
        sectionPath: ['标题', '甲', '甲子节'],
      });
      const [first, second] =
        order === 'parent-first' ? [parent, child] : [child, parent];
      expect(await approve(first)).toBe('ok');
      expect(await approve(second)).toBe('superseded');
    },
  );

  it('merges concurrent appended sources and remaps references without changing existing numbers', async () => {
    const baseSources = [
      { title: '基础资料', url: 'https://example.org/base' },
    ];
    await save(
      composeAiDraftBody(
        '# 标题\n\n## 甲\n\n甲原文[@#CIT 1]。\n\n## 乙\n\n乙原文[@#CIT 1]。',
        baseSources,
      ),
    );
    const cited = (title: string, url: string): DraftWriteInput => ({
      ...section(title, `${title}新增论据[@#CIT 1,2]。`),
      sources: [...baseSources, { title: `${title}资料`, url }],
      citationAudit: {
        conceptsAndDefinitions: [{ claim: '新增论据', sourceIndexes: [1, 2] }],
      },
    });
    const first = await propose(cited('甲', 'https://example.org/a'));
    const second = await propose(cited('乙', 'https://example.org/b'));
    expect(await approve(second)).toBe('ok');
    expect(await approve(first)).toBe('ok');
    const result = await body();
    expect(result).toContain('[1](https://example.org/base#cit-1');
    expect(result).toContain('[2](https://example.org/b#cit-2');
    expect(result).toContain('[3](https://example.org/a#cit-3');
    expect(result).toContain('3. [甲资料](https://example.org/a)');
    expect(result.match(/## 来源/g)).toHaveLength(1);
  });

  it('does not let a pending whole-document replacement erase an applied section', async () => {
    const whole = await propose({
      markdown: original,
      changeSummary: '重写全文',
    });
    const part = await propose(section('乙', '乙最新内容。'));
    expect(await approve(part)).toBe('ok');
    expect(await approve(whole)).toBe('superseded');
    expect(await body()).toContain('乙最新内容。');
  });

  it('does not apply a section if its target was deleted or renamed', async () => {
    const call = await propose(section('乙', '不该写入。'));
    await save(original.replace('## 乙', '## 新标题'));
    expect(await approve(call)).toBe('superseded');
    expect(await body()).not.toContain('不该写入。');
  });

  it('preserves a legacy pending section approval when another section has already been written', async () => {
    const callId = randomUUID();
    await pending.stash({
      toolCallId: callId,
      sessionKey,
      toolName: 'write_draft',
      targetContentItemId: targetId,
      payload: { ...section('甲', '旧审批内容。') },
      now: new Date(),
    });
    const next = await propose(section('乙', '新版审批内容。'));
    expect(await approve(next)).toBe('ok');
    expect(await approve(callId)).toBe('superseded');
    expect(await body()).toContain('新版审批内容。');
    expect(await body()).not.toContain('旧审批内容。');
  });

  it('rejects ambiguous duplicate headings added after the proposal', async () => {
    const callId = await propose(section('乙', '不应错位写入。'));
    await save(`${original}\n\n## 乙\n\n另一节。`);
    expect(await approve(callId)).toBe('superseded');
    expect(await body()).not.toContain('不应错位写入。');
  });

  it('returns the actual target validation error to the agent before creating an approval', async () => {
    const callId = randomUUID();
    const gated = gateWrite(createWriteDraftTool(drafts, targetId), {
      toolName: 'write_draft',
      sessionKey,
      pendingWriteRepo: pending,
      validate: validateDraftWriteInput,
      prepare: async (args) => ({
        draftSectionBase: await captureDraftSectionBase(drafts, targetId, args),
      }),
      buildPreview: () => ({}),
    }) as {
      execute: (args: unknown, opts: { toolCallId: string }) => Promise<string>;
    };
    const result = JSON.parse(
      await gated.execute(section('不存在', '新文。'), { toolCallId: callId }),
    ) as { summary: string; meta: { status: string } };
    expect(result.meta.status).toBe('invalid');
    expect(result.summary).toContain('未找到章节');
    expect(await pending.findById(callId)).toBeNull();
  });

  it('replays a section whose data was written but whose approval completion failed', async () => {
    const call = await propose(section('乙', '只写一次。'));
    const complete = jest
      .spyOn(pending, 'completeApproval')
      .mockRejectedValueOnce(new Error('simulated Mongo failure'));
    try {
      await supertest(ctx.app.getHttpServer())
        .post(`/api/v1/agent/writes/${call}/approve`)
        .set('Cookie', cookie)
        .send({ sessionKey })
        .expect(500);
      expect((await pending.findById(call))?.status).toBe('pending');
      const fence = (await drafts.findAiDraftByContentItemId(targetId))
        ?.approvalFence;
      expect(await approve(call)).toBe('ok');
      expect(
        (await drafts.findAiDraftByContentItemId(targetId))?.approvalFence,
      ).toBe(fence);
    } finally {
      complete.mockRestore();
    }
  });

  it('recomputes a merge after a real CAS collision, without losing either section', async () => {
    const a = section('甲', '甲并发修改。');
    const b = section('乙', '乙并发修改。');
    const aBase = (await captureDraftSectionBase(drafts, targetId, a))!;
    const bBase = (await captureDraftSectionBase(drafts, targetId, b))!;
    const originalSave = drafts.saveAiDraftIfUnchanged.bind(drafts);
    let arrivals = 0;
    let release!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveSpy = jest
      .spyOn(drafts, 'saveAiDraftIfUnchanged')
      .mockImplementation(async (input, expected) => {
        arrivals += 1;
        if (arrivals === 2) release();
        if (arrivals <= 2) await bothReady;
        return originalSave(input, expected);
      });
    try {
      await Promise.all([
        commitDraftWrite(
          drafts,
          targetId,
          a,
          new Date(),
          'unused-fence',
          aBase,
        ),
        commitDraftWrite(
          drafts,
          targetId,
          b,
          new Date(),
          'unused-fence',
          bBase,
        ),
      ]);
      expect(saveSpy).toHaveBeenCalledTimes(3);
      expect(await body()).toContain('甲并发修改。');
      expect(await body()).toContain('乙并发修改。');
    } finally {
      saveSpy.mockRestore();
    }
  });
});
