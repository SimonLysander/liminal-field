import { AgentRunManager } from '../agent-run-manager.service';

function makeAgent() {
  return { abort: jest.fn() };
}

describe('AgentRunManager', () => {
  it('同一会话开始新运行时取消旧运行', () => {
    const manager = new AgentRunManager();
    const first = makeAgent();
    const second = makeAgent();

    manager.begin('session-1', first as never);
    manager.begin('session-1', second as never);

    expect(first.abort).toHaveBeenCalledTimes(1);
    expect(second.abort).not.toHaveBeenCalled();
  });

  it('旧运行的 finish 不得删除同会话的新运行', () => {
    const manager = new AgentRunManager();
    const first = makeAgent();
    const second = makeAgent();
    const firstRunId = manager.begin('session-1', first as never);

    manager.begin('session-1', second as never);
    manager.finish('session-1', firstRunId);

    expect(manager.cancel('session-1')).toBe(true);
    expect(second.abort).toHaveBeenCalledTimes(1);
  });

  it('取消不存在的运行时幂等返回 false', () => {
    const manager = new AgentRunManager();

    expect(manager.cancel('missing')).toBe(false);
  });

  it('重复取消同一运行只中止一次', () => {
    const manager = new AgentRunManager();
    const agent = makeAgent();
    manager.begin('session-1', agent as never);

    expect(manager.cancel('session-1')).toBe(true);
    expect(manager.cancel('session-1')).toBe(false);
    expect(agent.abort).toHaveBeenCalledTimes(1);
  });

  it('过期运行的取消请求不得中止同会话的新运行', () => {
    const manager = new AgentRunManager();
    const first = makeAgent();
    const second = makeAgent();
    const firstRunId = manager.begin('session-1', first as never);
    manager.begin('session-1', second as never);

    expect(manager.cancel('session-1', firstRunId)).toBe(false);
    expect(second.abort).not.toHaveBeenCalled();
    expect(manager.cancel('session-1')).toBe(true);
  });
});
