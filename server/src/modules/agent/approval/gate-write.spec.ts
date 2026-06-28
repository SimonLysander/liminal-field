/**
 * gateWrite 单测:门禁 wrapper 把写工具变成「校验→暂存→pending_approval」,真 execute 不跑。
 */
import { gateWrite } from './gate-write';
import type { PendingWriteRepository } from './pending-write.repository';

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
      buildPreview: (a) => ({ charCount: (a.markdown as string).length }),
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
});
