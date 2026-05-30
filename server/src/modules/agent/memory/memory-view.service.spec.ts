/**
 * MemoryViewService 单测(2026-05-30 event log)。
 *
 * 覆盖路径:
 * - refreshIfNeeded 三种情况:bootstrap(冷启动) / 节流跳过 / 时间窗触发 / 数量阈触发
 * - 0 条 observations → 不触发
 * - LLM 返空 → 不 upsert
 * - LLM 抛错 → catch + log,不抛
 * - forceRefresh 跳过节流
 */
import { MemoryViewService } from './memory-view.service';
import type { AgentMemoryObservationRepository } from './agent-memory-observation.repository';

interface MockRepo {
  count: jest.Mock;
  findCurrentView: jest.Mock;
  findAll: jest.Mock;
  upsertCurrentView: jest.Mock;
}

function mkRepo(opts: Partial<MockRepo> = {}): MockRepo {
  return {
    count: opts.count ?? jest.fn().mockResolvedValue(0),
    findCurrentView: opts.findCurrentView ?? jest.fn().mockResolvedValue(null),
    findAll: opts.findAll ?? jest.fn().mockResolvedValue([]),
    upsertCurrentView:
      opts.upsertCurrentView ?? jest.fn().mockResolvedValue({}),
  };
}

function mkService(
  repo: MockRepo,
  llmResult: string | Error,
): MemoryViewService {
  const svc = new MemoryViewService(
    repo as unknown as AgentMemoryObservationRepository,
    {} as never,
  );
  const spy = jest.spyOn(
    svc as unknown as { callViewLLM: jest.Mock },
    'callViewLLM',
  );
  if (llmResult instanceof Error) {
    spy.mockRejectedValue(llmResult);
  } else {
    spy.mockResolvedValue(llmResult);
  }
  return svc;
}

describe('MemoryViewService.refreshIfNeeded', () => {
  it('0 条 observations → 跳过(no observations)', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, '## 身份\n...');
    const r = await svc.refreshIfNeeded();
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('no observations');
    expect(repo.upsertCurrentView).not.toHaveBeenCalled();
  });

  it('冷启动(有 observations 无 view)→ bootstrap 触发', async () => {
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(3),
      findCurrentView: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([{ topic: 'identity' }]),
    });
    const svc = mkService(repo, '## 身份\n在杭州');
    const r = await svc.refreshIfNeeded();
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe('bootstrap');
    expect(repo.upsertCurrentView).toHaveBeenCalledWith({
      markdown: '## 身份\n在杭州',
      observationCount: 3,
    });
  });

  it('节流跳过:距上次 1h + 累积 3 条 → 不触发', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(5), // current_view.observationCount=2 + 累积 3
      findCurrentView: jest
        .fn()
        .mockResolvedValue({ derivedAt: oneHourAgo, observationCount: 2 }),
    });
    const svc = mkService(repo, '...');
    const r = await svc.refreshIfNeeded();
    expect(r.triggered).toBe(false);
    expect(r.reason).toMatch(/节流/);
    expect(repo.upsertCurrentView).not.toHaveBeenCalled();
  });

  it('时间窗触发:距上次 8 天 → 触发', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(10),
      findCurrentView: jest
        .fn()
        .mockResolvedValue({ derivedAt: eightDaysAgo, observationCount: 8 }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    const svc = mkService(repo, '## 身份\n...');
    const r = await svc.refreshIfNeeded();
    expect(r.triggered).toBe(true);
    expect(r.reason).toMatch(/时间窗超阈/);
    expect(repo.upsertCurrentView).toHaveBeenCalled();
  });

  it('数量阈触发:1h 内但累积 16 条 → 触发', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(20), // 累积 16 ≥ 15
      findCurrentView: jest
        .fn()
        .mockResolvedValue({ derivedAt: oneHourAgo, observationCount: 4 }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    const svc = mkService(repo, '## 身份\n...');
    const r = await svc.refreshIfNeeded();
    expect(r.triggered).toBe(true);
    expect(r.reason).toMatch(/累积超阈/);
    expect(repo.upsertCurrentView).toHaveBeenCalled();
  });

  it('LLM 返空 → 不 upsert,reason=llm returned empty', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(5),
      findCurrentView: jest
        .fn()
        .mockResolvedValue({ derivedAt: eightDaysAgo, observationCount: 5 }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    const svc = mkService(repo, '   '); // 空 markdown
    const r = await svc.refreshIfNeeded();
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('llm returned empty');
    expect(repo.upsertCurrentView).not.toHaveBeenCalled();
  });

  it('LLM 抛错 → catch + 返 triggered=false,不抛', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(5),
      findCurrentView: jest
        .fn()
        .mockResolvedValue({ derivedAt: eightDaysAgo, observationCount: 5 }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    const svc = mkService(repo, new Error('LLM 502'));
    const r = await svc.refreshIfNeeded();
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe('error');
    expect(repo.upsertCurrentView).not.toHaveBeenCalled();
  });

  it('markdown 超 8000 字截断', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(5),
      findCurrentView: jest
        .fn()
        .mockResolvedValue({ derivedAt: eightDaysAgo, observationCount: 5 }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    const svc = mkService(repo, 'x'.repeat(9000));
    await svc.refreshIfNeeded();
    const arg = repo.upsertCurrentView.mock.calls[0][0];
    expect(arg.markdown).toHaveLength(8000);
  });
});

describe('MemoryViewService.forceRefresh', () => {
  it('跳过节流,只要有 observations 就跑', async () => {
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    const repo = mkRepo({
      count: jest.fn().mockResolvedValue(3),
      findCurrentView: jest
        .fn()
        .mockResolvedValue({ derivedAt: oneMinAgo, observationCount: 3 }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    const svc = mkService(repo, '## 身份\n...');
    const r = await svc.forceRefresh();
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe('force');
  });

  it('0 条仍跳过', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, '## 身份\n...');
    const r = await svc.forceRefresh();
    expect(r.triggered).toBe(false);
  });
});
