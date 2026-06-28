/**
 * PendingWriteCommitService 单测:approve 按 toolName 分派真正落库,reject 不落库;
 * 鉴权(sessionKey)、防竞态(resolve=false)、各工具落对应 repo。
 */
import { PendingWriteCommitService } from './pending-write.service';

function mocks() {
  const pendingRepo = { findById: jest.fn(), resolve: jest.fn() };
  const editorRepo = { saveAiDraft: jest.fn().mockResolvedValue(undefined) };
  const memoryRepo = { setTasks: jest.fn().mockResolvedValue(undefined) };
  const obsRepo = { appendMany: jest.fn().mockResolvedValue([]) };
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

  it('sessionKey 不符 → forbidden,不落库', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 'other',
      toolName: 'write_draft',
    });
    expect(await svc.approve('tc', 's')).toEqual({ status: 'forbidden' });
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
  });

  it('resolve=false(已裁决)→ already_resolved,不落库', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: { markdown: 'x' },
      targetContentItemId: 'ci',
    });
    pendingRepo.resolve.mockResolvedValue(false);
    expect(await svc.approve('tc', 's')).toEqual({
      status: 'already_resolved',
    });
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
  });

  it('write_draft → saveAiDraft(learn-draft)', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: { markdown: '# T\nbody' },
      targetContentItemId: 'ci',
    });
    pendingRepo.resolve.mockResolvedValue(true);
    expect(await svc.approve('tc', 's')).toEqual({ status: 'ok' });
    expect(editorRepo.saveAiDraft).toHaveBeenCalledTimes(1);
    expect(editorRepo.saveAiDraft.mock.calls[0][0]).toMatchObject({
      contentItemId: 'ci',
      bodyMarkdown: '# T\nbody',
      changeNote: 'learn-draft',
    });
  });

  it('write_learn_plan → saveAiDraft(learn-plan, title=goal)', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_learn_plan',
      payload: { goal: 'G', understanding: 'U。x', items: [] },
      targetContentItemId: 'ct',
    });
    pendingRepo.resolve.mockResolvedValue(true);
    await svc.approve('tc', 's');
    expect(editorRepo.saveAiDraft.mock.calls[0][0]).toMatchObject({
      contentItemId: 'ct',
      title: 'G',
      changeNote: 'learn-plan',
    });
  });

  it('write_tasks → setTasks(agentKey)', async () => {
    const { svc, pendingRepo, memoryRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_tasks',
      payload: { tasks: [{ title: 'a' }] },
      agentKey: 'ak',
    });
    pendingRepo.resolve.mockResolvedValue(true);
    await svc.approve('tc', 's');
    expect(memoryRepo.setTasks).toHaveBeenCalledTimes(1);
    expect(memoryRepo.setTasks.mock.calls[0][0]).toBe('ak');
  });

  it('remember → appendMany', async () => {
    const { svc, pendingRepo, obsRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'remember',
      payload: { observations: [{ topic: 'method', observation: 'o' }] },
    });
    pendingRepo.resolve.mockResolvedValue(true);
    await svc.approve('tc', 's');
    expect(obsRepo.appendMany).toHaveBeenCalledTimes(1);
  });

  it('write_draft 缺 targetContentItemId → 抛错(不静默返回 ok)', async () => {
    const { svc, pendingRepo, editorRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
      payload: { markdown: 'x' }, // 没 targetContentItemId
    });
    pendingRepo.resolve.mockResolvedValue(true);
    await expect(svc.approve('tc', 's')).rejects.toThrow();
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
  });
});

describe('PendingWriteCommitService.reject', () => {
  it('resolve 成功 → ok,且不调任何写 repo', async () => {
    const { svc, pendingRepo, editorRepo, memoryRepo, obsRepo } = mocks();
    pendingRepo.findById.mockResolvedValue({
      sessionKey: 's',
      toolName: 'write_draft',
    });
    pendingRepo.resolve.mockResolvedValue(true);
    expect(await svc.reject('tc', 's')).toEqual({ status: 'ok' });
    expect(editorRepo.saveAiDraft).not.toHaveBeenCalled();
    expect(memoryRepo.setTasks).not.toHaveBeenCalled();
    expect(obsRepo.appendMany).not.toHaveBeenCalled();
  });
});
