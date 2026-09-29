/**
 * gateWrite 单测:门禁 wrapper 把写工具变成「校验→暂存→pending_approval」,真 execute 不跑。
 */
import { gateWrite } from '../gate-write';
import type { PendingWriteRepository } from '../pending-write.repository';

interface Parsed {
  meta?: { status?: string; toolCallId?: string };
}
const parse = (s: unknown) => JSON.parse(s as string) as Parsed;

function mkRepo() {
  return {
    stash: jest.fn().mockResolvedValue(undefined),
  } as unknown as PendingWriteRepository & { stash: jest.Mock };
}

function mkRealTool() {
  return {
    description: 'real desc',
    inputSchema: { type: 'object' as const },
    execute: jest.fn().mockResolvedValue('REAL_RAN'),
  };
}

describe('gateWrite', () => {
  it('保留 realTool 的 description / inputSchema', () => {
    const rt = mkRealTool();
    const gated = gateWrite(rt, {
      toolName: 'write_draft',
      sessionKey: 's1',
      pendingWriteRepo: mkRepo(),
      buildPreview: () => ({}),
    }) as { description: string; inputSchema: unknown };
    expect(gated.description).toBe('real desc');
    expect(gated.inputSchema).toEqual({ type: 'object' });
  });

  it('execute:暂存 + 返回 pending_approval,且不调用真 execute', async () => {
    const rt = mkRealTool();
    const repo = mkRepo();
    const gated = gateWrite(rt, {
      toolName: 'write_draft',
      sessionKey: 's1',
      targetContentItemId: 'ci_x',
      pendingWriteRepo: repo,
      buildPreview: (a) => ({ stats: `${(a.markdown as string).length} 字` }),
    }) as {
      execute: (
        a: Record<string, unknown>,
        o: { toolCallId: string },
      ) => Promise<string>;
    };

    const r = parse(
      await gated.execute({ markdown: 'hello' }, { toolCallId: 'tc1' }),
    );
    expect(r.meta?.status).toBe('pending_approval');
    expect(r.meta?.toolCallId).toBe('tc1');
    expect(repo.stash).toHaveBeenCalledTimes(1);
    expect(repo.stash.mock.calls[0][0]).toMatchObject({
      toolCallId: 'tc1',
      sessionKey: 's1',
      toolName: 'write_draft',
      targetContentItemId: 'ci_x',
      payload: { markdown: 'hello' },
    });
    expect(rt.execute).not.toHaveBeenCalled();
  });

  it('validate 不过 → invalid,且不暂存', async () => {
    const repo = mkRepo();
    const gated = gateWrite(mkRealTool(), {
      toolName: 'remember',
      sessionKey: 's1',
      pendingWriteRepo: repo,
      validate: () => '太长了',
      buildPreview: () => ({}),
    }) as {
      execute: (
        a: Record<string, unknown>,
        o: { toolCallId: string },
      ) => Promise<string>;
    };

    const r = parse(
      await gated.execute({ observations: [] }, { toolCallId: 'tc2' }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(repo.stash).not.toHaveBeenCalled();
  });

  it('捕获系统前置条件，不信任参数中伪造的快照', async () => {
    const repo = mkRepo();
    const base = { hash: 'actual', sourceCount: 0, occurrenceCount: 1 };
    const gated = gateWrite(mkRealTool(), {
      toolName: 'write_draft',
      sessionKey: 's',
      pendingWriteRepo: repo,
      prepare: () => Promise.resolve({ draftSectionBase: base }),
      buildPreview: () => ({}),
    }) as {
      execute: (a: unknown, o: { toolCallId: string }) => Promise<string>;
    };
    await gated.execute(
      { draftSectionBase: { hash: 'forged' } },
      { toolCallId: 'call' },
    );
    expect(repo.stash).toHaveBeenCalledWith(
      expect.objectContaining({ draftSectionBase: base }),
    );
  });

  it('前置条件捕获失败时不创建无法执行的审批卡', async () => {
    const repo = mkRepo();
    const gated = gateWrite(mkRealTool(), {
      toolName: 'write_draft',
      sessionKey: 's',
      pendingWriteRepo: repo,
      prepare: () => Promise.reject(new Error('目标不存在')),
      buildPreview: () => ({}),
    }) as {
      execute: (a: unknown, o: { toolCallId: string }) => Promise<string>;
    };
    const result = parse(await gated.execute({}, { toolCallId: 'call' }));
    expect(result.meta?.status).toBe('error');
    expect(repo.stash).not.toHaveBeenCalled();
  });

  it('非对象参数 → invalid,且不进入工具级校验和预览', async () => {
    const repo = mkRepo();
    const validate = jest.fn();
    const buildPreview = jest.fn();
    const gated = gateWrite(mkRealTool(), {
      toolName: 'write_learn_plan',
      sessionKey: 's1',
      pendingWriteRepo: repo,
      validate,
      buildPreview,
    }) as {
      execute: (a: unknown, o: { toolCallId: string }) => Promise<string>;
    };

    const r = parse(await gated.execute(null, { toolCallId: 'tc3' }));

    expect(r.meta?.status).toBe('invalid');
    expect(validate).not.toHaveBeenCalled();
    expect(buildPreview).not.toHaveBeenCalled();
    expect(repo.stash).not.toHaveBeenCalled();
  });
});
