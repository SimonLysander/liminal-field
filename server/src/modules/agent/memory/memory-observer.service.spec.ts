/**
 * MemoryObserverService 单测(2026-05-30,#150 续 event log)。
 *
 * 覆盖路径:
 * - 空/短对话 → 不调 LLM,返 0
 * - LLM 返 N 条 + currentView → 批量 append + upsert view
 * - LLM 返空 → 不 append, 不 upsert view
 * - LLM 返非法 topic → 自动落 other
 * - LLM 返超长 observation / context / view → 截断
 * - LLM 抛错 → catch + log,返 0(observer 失败绝不阻塞用户)
 */
import { MemoryObserverService } from './memory-observer.service';
import type { AgentMemoryObservationRepository } from './agent-memory-observation.repository';
import type { ObservationTopic } from './agent-memory-observation.entity';

const mkMsg = (role: string, text: string) => ({
  role,
  parts: [{ type: 'text', text }],
});

interface MockRepo {
  findRecent: jest.Mock;
  appendMany: jest.Mock;
  count: jest.Mock;
  upsertCurrentView: jest.Mock;
}

function mkRepo(): MockRepo {
  return {
    findRecent: jest.fn().mockResolvedValue([]),
    appendMany: jest
      .fn()
      .mockImplementation((items: unknown[]) =>
        Promise.resolve(items.map((i, idx) => ({ ...(i as object), _id: idx }))),
      ),
    count: jest.fn().mockResolvedValue(0),
    upsertCurrentView: jest.fn().mockResolvedValue({}),
  };
}

/**
 * 用 spyOn(svc as any, 'callObserverLLM') 替代真实 LLM 调用,
 * 让测试聚焦"主路径业务逻辑",不依赖外部 generateText。
 */
function mkService(
  repo: MockRepo,
  llmResult: unknown | Error,
): MemoryObserverService {
  const svc = new MemoryObserverService(
    repo as unknown as AgentMemoryObservationRepository,
    {} as never, // systemConfigService 不被业务逻辑直接读
  );
  const spy = jest.spyOn(
    svc as unknown as { callObserverLLM: jest.Mock },
    'callObserverLLM',
  );
  if (llmResult instanceof Error) {
    spy.mockRejectedValue(llmResult);
  } else {
    spy.mockResolvedValue(llmResult);
  }
  return svc;
}

describe('MemoryObserverService.observe', () => {
  it('空消息 → 不调 LLM,返 0', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, { observations: [], currentView: '' });
    const r = await svc.observe([]);
    expect(r.observationsAdded).toBe(0);
    expect(repo.findRecent).not.toHaveBeenCalled();
    expect(repo.appendMany).not.toHaveBeenCalled();
  });

  it('对话太短(<20 字符) → 不调 LLM,返 0', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, { observations: [], currentView: '' });
    // buildConversationText 会加 "[user]: " 前缀,所以纯文本要很短才会触发短路
    const r = await svc.observe([mkMsg('user', '嗯')]);
    expect(r.observationsAdded).toBe(0);
    expect(repo.findRecent).not.toHaveBeenCalled();
  });

  it('LLM 返 3 条 + view → 批量 append + upsert view', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, {
      observations: [
        { topic: 'identity', observation: '在杭州' },
        { topic: 'method', observation: '晨写', context: '聊作息' },
        { topic: 'aesthetic', observation: '偏黑白' },
      ],
      currentView: '## 身份\n在杭州。\n\n## 方法\n晨写。',
    });
    const r = await svc.observe([
      mkMsg('user', '我搬到杭州了,最近习惯早起写作'),
      mkMsg('assistant', '挺好的——晨写注意力会高'),
    ]);
    expect(r.observationsAdded).toBe(3);
    expect(repo.appendMany).toHaveBeenCalledTimes(1);
    const appended = repo.appendMany.mock.calls[0][0];
    expect(appended).toHaveLength(3);
    expect(appended[0].topic).toBe('identity');
    expect(appended[1].context).toBe('聊作息');
    // upsert view 被调用,markdown 含我们传的内容
    expect(repo.upsertCurrentView).toHaveBeenCalledTimes(1);
    expect(repo.upsertCurrentView.mock.calls[0][0].markdown).toContain('晨写');
  });

  it('LLM 返空 observations + 空 view → 不 append, 不 upsert', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, { observations: [], currentView: '' });
    const r = await svc.observe([
      mkMsg('user', '哈哈那个文档我等下再看,你先休息'),
      mkMsg('assistant', '好的!'),
    ]);
    expect(r.observationsAdded).toBe(0);
    // appendMany 仍被调用(传空数组),repository 内部短路返 []
    expect(repo.appendMany).toHaveBeenCalledWith([]);
    expect(repo.upsertCurrentView).not.toHaveBeenCalled();
  });

  it('LLM 返非法 topic → 自动落 other', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, {
      observations: [{ topic: 'wuwu' as ObservationTopic, observation: '怪' }],
      currentView: '',
    });
    await svc.observe([
      mkMsg('user', '我最近发现自己有第六感对季节变化敏感'),
      mkMsg('assistant', '挺有意思的'),
    ]);
    const appended = repo.appendMany.mock.calls[0][0];
    expect(appended[0].topic).toBe('other');
  });

  it('observation 超长 500 / context 超长 300 / view 超长 8000 都截断', async () => {
    const repo = mkRepo();
    const longObs = 'a'.repeat(600);
    const longCtx = 'b'.repeat(400);
    const longView = 'c'.repeat(10000);
    const svc = mkService(repo, {
      observations: [
        {
          topic: 'method' as ObservationTopic,
          observation: longObs,
          context: longCtx,
        },
      ],
      currentView: longView,
    });
    await svc.observe([
      mkMsg('user', '我们继续讨论这个事情,我觉得这样这样这样这样'),
      mkMsg('assistant', '是的'),
    ]);
    const appended = repo.appendMany.mock.calls[0][0];
    expect(appended[0].observation).toHaveLength(500);
    expect(appended[0].context).toHaveLength(300);
    const viewArg = repo.upsertCurrentView.mock.calls[0][0];
    expect(viewArg.markdown).toHaveLength(8000);
  });

  it('LLM 抛错 → catch + 返 0(不抛,不阻塞用户)', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, new Error('LLM 502 Bad Gateway'));
    const r = await svc.observe([
      mkMsg('user', '我们继续讨论这个事情,我觉得这样这样这样'),
      mkMsg('assistant', '好的'),
    ]);
    expect(r.observationsAdded).toBe(0);
    expect(repo.appendMany).not.toHaveBeenCalled();
  });

  it('sessionKey 透传到每条 observation', async () => {
    const repo = mkRepo();
    const svc = mkService(repo, {
      observations: [
        { topic: 'method', observation: '观察' },
        { topic: 'identity', observation: '观察 2' },
      ],
      currentView: '',
    });
    await svc.observe(
      [
        mkMsg('user', '我们继续讨论这个事情,我觉得这样这样'),
        mkMsg('assistant', '好的'),
      ],
      'sess-abc-123',
    );
    const appended = repo.appendMany.mock.calls[0][0];
    expect(appended[0].sessionKey).toBe('sess-abc-123');
    expect(appended[1].sessionKey).toBe('sess-abc-123');
  });
});
