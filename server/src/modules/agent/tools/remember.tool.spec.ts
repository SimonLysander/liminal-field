/**
 * remember 工具(2026-05-30 event log)单测。
 *
 * 覆盖路径:
 * - 批量正常路径:全过校验 → batch append → ack
 * - 非法 topic / 超字数 / 空 observation → invalid + 整批 reject(不写库)
 * - 一次最多 10 条限制
 * - meta.list 字段给前端 NestedList 渲染
 */
import type { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import type {
  AgentMemoryObservation,
  ObservationTopic,
} from '../memory/agent-memory-observation.entity';
import { createRememberTool } from './remember.tool';

interface ParsedResult {
  summary: string;
  detail?: string;
  meta?: {
    status?: string;
    added?: number;
    list?: string[];
  };
}
const parse = (s: unknown) => JSON.parse(s as string) as ParsedResult;

/** mock repository:appendMany 返回 inserted items(带 _id) */
function mkRepo(appendSpy?: jest.Mock) {
  const spy =
    appendSpy ??
    jest.fn().mockImplementation((items: unknown[]) =>
      Promise.resolve(
        items.map(
          (i, idx) =>
            ({
              ...(i as object),
              _id: `id-${idx}`,
            }) as unknown as AgentMemoryObservation,
        ),
      ),
    );
  return {
    appendMany: spy,
  } as unknown as AgentMemoryObservationRepository;
}

describe('remember tool (event log)', () => {
  it('正常批量 → append + ack 含 added/observationIds/list', async () => {
    const repo = mkRepo();
    const tool = createRememberTool(repo, 'sess-1');
    const r = parse(
      await (tool as any).execute({
        observations: [
          {
            topic: 'identity',
            observation: '现在做产品设计师',
            context: '聊近况转岗时',
          },
          { topic: 'method', observation: '笔记用 Plate' },
        ],
      }),
    );
    expect(r.meta?.status).toBe('ok');
    expect(r.meta?.added).toBe(2);
    expect(r.meta?.list).toHaveLength(2);
    // summary 含 topic 统计
    expect(r.summary).toMatch(/记下 2 条/);
    expect(r.summary).toContain('identity×1');
    expect(r.summary).toContain('method×1');
    // appendMany 收到 sessionKey 透传
    const appended = (repo.appendMany as jest.Mock).mock.calls[0][0];
    expect(appended[0].sessionKey).toBe('sess-1');
  });

  it('非法 topic → 整批 reject,不调 appendMany', async () => {
    const spy = jest.fn();
    const repo = mkRepo(spy);
    const tool = createRememberTool(repo);
    const r = parse(
      await (tool as any).execute({
        observations: [
          { topic: 'wuwu' as ObservationTopic, observation: '观察' },
        ],
      }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.summary).toMatch(/topic 不合法/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('observation 超 120 字 → 整批 reject + 提示挪到 context', async () => {
    const spy = jest.fn();
    const repo = mkRepo(spy);
    const tool = createRememberTool(repo);
    const r = parse(
      await (tool as any).execute({
        observations: [{ topic: 'method', observation: 'a'.repeat(130) }],
      }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.summary).toMatch(/observation 超过 120 字/);
    expect(r.summary).toMatch(/挪回 context/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('context 超 300 字 → 整批 reject', async () => {
    const spy = jest.fn();
    const repo = mkRepo(spy);
    const tool = createRememberTool(repo);
    const r = parse(
      await (tool as any).execute({
        observations: [
          {
            topic: 'aesthetic',
            observation: '简洁',
            context: 'b'.repeat(350),
          },
        ],
      }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.summary).toMatch(/context 超过 300 字/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('observation 空 → 整批 reject', async () => {
    const spy = jest.fn();
    const repo = mkRepo(spy);
    const tool = createRememberTool(repo);
    const r = parse(
      await (tool as any).execute({
        observations: [{ topic: 'method', observation: '   ' }],
      }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.summary).toMatch(/observation 必填且不能空/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('一次超 10 条 → 整批 reject', async () => {
    const spy = jest.fn();
    const repo = mkRepo(spy);
    const tool = createRememberTool(repo);
    const r = parse(
      await (tool as any).execute({
        observations: Array.from({ length: 11 }, () => ({
          topic: 'method',
          observation: '观察',
        })),
      }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(r.summary).toMatch(/一次最多 10 条/);
    expect(spy).not.toHaveBeenCalled();
  });

  it('空数组 → 整批 reject', async () => {
    const spy = jest.fn();
    const repo = mkRepo(spy);
    const tool = createRememberTool(repo);
    const r = parse(await (tool as any).execute({ observations: [] }));
    expect(r.meta?.status).toBe('invalid');
    expect(spy).not.toHaveBeenCalled();
  });

  it('整批写入是原子的:任一非法 → 全不写', async () => {
    const spy = jest.fn();
    const repo = mkRepo(spy);
    const tool = createRememberTool(repo);
    // 第一条合法,第二条非法 → 整批 reject
    const r = parse(
      await (tool as any).execute({
        observations: [
          { topic: 'identity', observation: '在杭州' },
          { topic: 'method', observation: 'x'.repeat(200) },
        ],
      }),
    );
    expect(r.meta?.status).toBe('invalid');
    expect(spy).not.toHaveBeenCalled();
  });

  it('observation 含空白 trim 后入库', async () => {
    const repo = mkRepo();
    const tool = createRememberTool(repo);
    await (tool as any).execute({
      observations: [
        {
          topic: 'method',
          observation: '   笔记用 Plate   ',
          context: ' 聊工具时 ',
        },
      ],
    });
    const appended = (repo.appendMany as jest.Mock).mock.calls[0][0];
    expect(appended[0].observation).toBe('笔记用 Plate');
    expect(appended[0].context).toBe('聊工具时');
  });

  it('meta.list 每条预览 24 字截断 + ...', async () => {
    const repo = mkRepo();
    const tool = createRememberTool(repo);
    // 35 字超 24 触发截断
    const longObs =
      '极简注释、克制装饰、详略由我、舍弃形容词、追求一击中的的语言密度。';
    const r = parse(
      await (tool as any).execute({
        observations: [{ topic: 'aesthetic', observation: longObs }],
      }),
    );
    expect(r.meta?.list?.[0]).toContain('[aesthetic]');
    expect(r.meta?.list?.[0]).toContain('…');
    // 预览长度 = 24 字 + "…"
    expect(r.meta?.list?.[0].length).toBeLessThanOrEqual(
      '[aesthetic] '.length + 24 + 1,
    );
  });
});
