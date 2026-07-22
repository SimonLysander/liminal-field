/**
 * PendingWriteCommitService 单测:approve 按 toolName 分派真正落库,reject 不落库;
 * 鉴权(sessionKey)、提交租约、各工具落对应 repo。
 */
import { PendingWriteCommitService } from '../pending-write.service';

function mocks() {
  const pendingRepo = {
    claimApproval: jest.fn().mockResolvedValue({
      commitVersion: 1,
      fenceSequence: 7,
    }),
    completeApproval: jest.fn().mockResolvedValue(true),
    completeSuperseded: jest.fn().mockResolvedValue(true),
    findById: jest.fn(),
    reject: jest.fn().mockResolvedValue(true),
    reopenAfterFailedApproval: jest.fn().mockResolvedValue(true),
    reopenStaleApproval: jest.fn().mockResolvedValue(false),
  };
  const editorRepo = {
    findAiDraftByContentItemId: jest.fn().mockResolvedValue(null),
    saveAiDraft: jest.fn().mockResolvedValue(undefined),
    saveAiDraftFenced: jest.fn().mockResolvedValue(true),
  };
  const memoryRepo = {
    setTasks: jest.fn().mockResolvedValue(undefined),
    setTasksFenced: jest.fn().mockResolvedValue(true),
  };
  const obsRepo = {
    appendManyIdempotent: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new PendingWriteCommitService(
    pendingRepo as never,
    editorRepo as never,
    memoryRepo as never,
    obsRepo as never,
  );
  return { svc, pendingRepo, editorRepo, memoryRepo, obsRepo };
}

describe('PendingWriteCommitService.approve', () => {
  it('pending 不存在 → not_found', async () => {
    const { svc, pendingRepo } = mocks();
    pendingRepo.findById.mockResolvedValue(null);
    expect(await svc.approve('tc', 's')).toEqual({ status: 'not_found' });
  });

  it('TTL 监视器尚未删除记录时仍拒绝已过期审批', async () => {
    const { svc, pendingRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      status: 'pending',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      toolName: 'write_draft',
    });

    await expect(svc.approve('tc', 's')).resolves.toEqual({
      status: 'expired',
    });
    expect(pendingRepo.claimApproval).not.toHaveBeenCalled();
  });

  it('sessionKey 不符 → forbidden,不落库', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 'other',
      toolName: 'write_draft',
    });
    expect(await svc.approve('tc', 's')).toEqual({ status: 'forbidden' });
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
  });

  it('claim=false(并发处理中)→ in_progress,不落库', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: { markdown: 'x' },
      targetContentItemId: 'ci',
    });
    pendingRepo.claimApproval.mockResolvedValue(null);
    expect(await svc.approve('tc', 's')).toEqual({
      status: 'in_progress',
    });
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
  });

  it('claim 竞态失败后发现已完成 → already_resolved', async () => {
    const { svc, pendingRepo } = mocks();
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    pendingRepo.findById
      .mockResolvedValueOnce({
        sessionKey: 's',
        status: 'pending',
        toolName: 'write_draft',
        payload: { markdown: '# T\nbody', changeSummary: '生成初稿。' },
        targetContentItemId: 'ci',
      })
      .mockResolvedValueOnce({ status: 'approved', resolvedAt });
    pendingRepo.claimApproval.mockResolvedValue(null);

    await expect(svc.approve('tc', 's')).resolves.toEqual({
      status: 'already_resolved',
      resolution: 'approved',
      resolvedAt,
    });
  });

  it('claim 竞态失败后发现已被取代 → superseded', async () => {
    const { svc, pendingRepo } = mocks();
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    pendingRepo.findById
      .mockResolvedValueOnce({
        sessionKey: 's',
        status: 'pending',
        toolName: 'write_draft',
      })
      .mockResolvedValueOnce({ status: 'superseded', resolvedAt });
    pendingRepo.claimApproval.mockResolvedValue(null);

    await expect(svc.approve('tc', 's')).resolves.toEqual({
      status: 'superseded',
      resolvedAt,
    });
  });

  it('未过期的 committing 租约返回 in_progress，不重复执行', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      status: 'committing',
      toolName: 'write_draft',
      payload: { markdown: '# T\nbody', changeSummary: '生成初稿。' },
      targetContentItemId: 'ci',
    });

    await expect(svc.approve('tc', 's')).resolves.toEqual({
      status: 'in_progress',
    });
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
  });

  it('已被取代的审批再次允许时透传 superseded 终态', async () => {
    const { svc, pendingRepo } = mocks();
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      status: 'superseded',
      toolName: 'write_draft',
      resolvedAt,
    });

    await expect(svc.approve('tc', 's')).resolves.toEqual({
      status: 'superseded',
      resolvedAt,
    });
    expect(pendingRepo.claimApproval).not.toHaveBeenCalled();
  });

  it('其他设备已完成审批时返回真实终态', async () => {
    const { svc, pendingRepo } = mocks();
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      status: 'approved',
      toolName: 'write_draft',
      resolvedAt,
    });

    await expect(svc.approve('tc', 's')).resolves.toEqual({
      status: 'already_resolved',
      resolution: 'approved',
      resolvedAt,
    });
    expect(pendingRepo.claimApproval).not.toHaveBeenCalled();
  });

  it('过期 committing 租约可被接管并幂等完成', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      status: 'committing',
      toolName: 'write_draft',
      payload: { markdown: '# T\nbody', changeSummary: '生成初稿。' },
      targetContentItemId: 'ci',
    });
    pendingRepo.reopenStaleApproval.mockResolvedValue(true);

    const result = await svc.approve('tc', 's');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.resolvedAt).toBeInstanceOf(Date);
    expect(pendingRepo.claimApproval).toHaveBeenCalled();
    expect(editorRepo.saveAiDraftFenced).toHaveBeenCalledTimes(1);
    expect(pendingRepo.completeApproval).toHaveBeenCalledWith(
      'tc',
      expect.any(String),
      result.resolvedAt,
    );
  });

  it('write_draft → saveAiDraftFenced(learn-draft)', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: { markdown: '# T\nbody', changeSummary: '生成完整初稿。' },
      targetContentItemId: 'ci',
    });
    expect(await svc.approve('tc', 's')).toMatchObject({
      status: 'ok',
      resolvedAt: expect.any(Date),
    });
    expect(editorRepo.saveAiDraftFenced).toHaveBeenCalledTimes(1);
    expect(editorRepo.saveAiDraftFenced.mock.calls[0][0]).toMatchObject({
      contentItemId: 'ci',
      bodyMarkdown: '# T\nbody',
      changeNote: 'learn-draft',
    });
    expect(editorRepo.saveAiDraftFenced.mock.calls[0][1]).toBe(
      '00000000000000000007:0000000001',
    );
  });

  it('目标已有更新内容时将旧审批落为 superseded，不恢复 pending', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: { markdown: '# 旧稿\n正文', changeSummary: '生成旧稿。' },
      targetContentItemId: 'ci',
    });
    editorRepo.saveAiDraftFenced.mockResolvedValue(false);

    await expect(svc.approve('tc', 's')).resolves.toMatchObject({
      status: 'superseded',
      resolvedAt: expect.any(Date),
    });
    expect(pendingRepo.completeSuperseded).toHaveBeenCalledWith(
      'tc',
      expect.any(String),
      expect.any(Date),
    );
    expect(pendingRepo.reopenAfterFailedApproval).not.toHaveBeenCalled();
  });

  it('write_draft 局部重写 → 复用同一替换逻辑，不覆盖相邻小节', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    editorRepo.findAiDraftByContentItemId.mockResolvedValue({
      bodyMarkdown: '# 标题\n\n## 目标\n\n旧内容。\n\n## 保留\n\n相邻内容。',
      title: '原标题',
    });
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: {
        operation: 'replace_section',
        sectionPath: ['标题', '目标'],
        sectionMarkdown: '新内容。',
        changeSummary: '重写目标小节。',
        sources: [],
      },
      targetContentItemId: 'ci',
    });

    expect(await svc.approve('tc', 's')).toMatchObject({
      status: 'ok',
      resolvedAt: expect.any(Date),
    });
    expect(editorRepo.saveAiDraftFenced.mock.calls[0][0]).toMatchObject({
      bodyMarkdown: '# 标题\n\n## 目标\n\n新内容。\n\n## 保留\n\n相邻内容。',
      title: '原标题',
    });
  });

  it('write_learn_plan → saveAiDraft(learn-plan, title=goal)', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_learn_plan',
      payload: {
        goal: 'G',
        understanding: '第一段。\n\n第二段。\n\n第三段。',
        items: [{ title: '基础', thread: '起点', why: '建立基础。' }],
        conclusion: 'C。y',
        changeSummary: '按知识依赖组织规划。',
      },
      targetContentItemId: 'ct',
    });
    await svc.approve('tc', 's');
    expect(editorRepo.saveAiDraftFenced.mock.calls[0][0]).toMatchObject({
      contentItemId: 'ct',
      title: 'G',
      changeNote: 'learn-plan',
    });
    expect(
      editorRepo.saveAiDraftFenced.mock.calls[0][0].bodyMarkdown,
    ).toContain('conclusion: C。y');
  });

  it('上线切换时允许批准旧版未带 conclusion 的完整规划', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_learn_plan',
      payload: {
        goal: '旧版规划',
        understanding: '第一段。\n\n第二段。\n\n第三段。',
        items: [{ title: '基础', thread: '起点', why: '建立基础。' }],
        changeSummary: '按知识依赖组织规划。',
      },
      targetContentItemId: 'ct',
    });

    await expect(svc.approve('tc', 's')).resolves.toMatchObject({
      status: 'ok',
      resolvedAt: expect.any(Date),
    });
    expect(editorRepo.saveAiDraftFenced.mock.calls[0][0]).toMatchObject({
      contentItemId: 'ct',
      title: '旧版规划',
    });
  });

  it('write_learn_plan 待审批参数损坏时拒绝落库并恢复 pending', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_learn_plan',
      payload: {
        goal: '旧规划',
        understanding: '旧开篇。',
        items: [{ title: '基础', thread: '起点', why: '建立基础。' }],
        changeSummary: '组织规划。',
      },
      targetContentItemId: 'ct',
    });
    await expect(svc.approve('tc', 's')).rejects.toThrow('understanding');
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
    expect(pendingRepo.reopenAfterFailedApproval).toHaveBeenCalledWith(
      'tc',
      expect.any(String),
    );
  });

  it('write_learn_plan 落库失败时恢复为 pending，允许用户重试审批', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_learn_plan',
      payload: {
        goal: '概要',
        understanding: '第一段。\n\n第二段。\n\n第三段。',
        items: [{ title: '基础', thread: '起点', why: '建立基础。' }],
        conclusion: '收束。',
        changeSummary: '按知识依赖组织规划。',
      },
      targetContentItemId: 'ct',
    });
    editorRepo.saveAiDraftFenced.mockRejectedValue(
      new Error('MongoDB timeout'),
    );

    await expect(svc.approve('tc', 's')).rejects.toThrow('MongoDB timeout');
    expect(pendingRepo.reopenAfterFailedApproval).toHaveBeenCalledWith(
      'tc',
      expect.any(String),
    );
  });

  it('write_tasks → setTasksFenced(agentKey)', async () => {
    const { svc, pendingRepo, memoryRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_tasks',
      payload: { tasks: [{ title: 'a' }] },
      agentKey: 'ak',
    });
    await svc.approve('tc', 's');
    expect(memoryRepo.setTasksFenced).toHaveBeenCalledTimes(1);
    expect(memoryRepo.setTasksFenced.mock.calls[0][0]).toBe('ak');
    expect(memoryRepo.setTasksFenced.mock.calls[0][2]).toBe(
      '00000000000000000007:0000000001',
    );
  });

  it('remember → appendManyIdempotent(toolCallId)', async () => {
    const { svc, pendingRepo, obsRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'remember',
      payload: { observations: [{ topic: 'method', observation: 'o' }] },
    });
    await svc.approve('tc', 's');
    expect(obsRepo.appendManyIdempotent).toHaveBeenCalledWith(
      'tc',
      expect.any(Array),
    );
  });

  it('write_draft 缺 targetContentItemId → 抛错(不静默返回 ok)', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: { markdown: 'x', changeSummary: '生成初稿。' }, // 没 targetContentItemId
    });
    await expect(svc.approve('tc', 's')).rejects.toThrow();
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
    expect(pendingRepo.reopenAfterFailedApproval).toHaveBeenCalledWith(
      'tc',
      expect.any(String),
    );
  });
});

describe('PendingWriteCommitService.reject', () => {
  it('reject 成功 → ok,且不调任何写 repo', async () => {
    const { svc, pendingRepo, editorRepo, memoryRepo, obsRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
    });
    const result = await svc.reject('tc', 's');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.resolvedAt).toBeInstanceOf(Date);
    expect(pendingRepo.reject).toHaveBeenCalledWith('tc', result.resolvedAt);
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
    expect(editorRepo.saveAiDraftFenced).not.toHaveBeenCalled();
    expect(memoryRepo.setTasks).not.toHaveBeenCalled();
    expect(memoryRepo.setTasksFenced).not.toHaveBeenCalled();
    expect(obsRepo.appendManyIdempotent).not.toHaveBeenCalled();
  });

  it('已被取代的审批再次拒绝时透传 superseded 终态', async () => {
    const { svc, pendingRepo } = mocks();
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      status: 'superseded',
      toolName: 'write_draft',
      resolvedAt,
    });

    await expect(svc.reject('tc', 's')).resolves.toEqual({
      status: 'superseded',
      resolvedAt,
    });
    expect(pendingRepo.reject).not.toHaveBeenCalled();
  });

  it('reject 竞态失败后发现已被取代 → superseded', async () => {
    const { svc, pendingRepo } = mocks();
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    pendingRepo.findById
      .mockResolvedValueOnce({
        sessionKey: 's',
        status: 'pending',
        toolName: 'write_draft',
      })
      .mockResolvedValueOnce({ status: 'superseded', resolvedAt });
    pendingRepo.reject.mockResolvedValue(false);

    await expect(svc.reject('tc', 's')).resolves.toEqual({
      status: 'superseded',
      resolvedAt,
    });
  });
});

describe('PendingWriteCommitService.getApproval', () => {
  it('按 toolCallId 返回同一会话的权威终态与裁决时间', async () => {
    const { svc, pendingRepo } = mocks();
    const resolvedAt = new Date('2026-07-21T01:02:03.000Z');
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      status: 'approved',
      resolvedAt,
    });

    await expect(svc.getApproval('tc', 's')).resolves.toEqual({
      status: 'approved',
      resolvedAt,
    });
  });

  it('不向其他会话暴露审批状态', async () => {
    const { svc, pendingRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 'other',
      status: 'approved',
      resolvedAt: new Date(),
    });

    await expect(svc.getApproval('tc', 's')).resolves.toBeNull();
  });
});
