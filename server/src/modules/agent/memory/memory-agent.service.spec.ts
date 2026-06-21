/**
 * matchScore / extractJSON 纯函数契约测试 + MemoryAgentService.forget 数据安全测试。
 *
 * matchScore 错会误删记忆;extractJSON 错会让记忆写入整链崩;两者零依赖纯函数,直接断言。
 *
 * forget(2026-05-31 补,#150 续):design §3.6 风险最高的工具。覆盖四条路径:
 *   0 条 / 0 分匹配 → not_found;1 条命中 → ok + 删;多条强匹配 → ambiguous 不删;并列最高分 → ambiguous 不删。
 */
import {
  MemoryAgentService,
  matchScore,
  extractJSON,
} from './memory-agent.service';
import type { AgentMemory } from './agent-memory.entity';

describe('matchScore', () => {
  it('description 所有词都命中 target → 1', () => {
    expect(
      matchScore('quantum computing', 'intro to quantum computing basics'),
    ).toBe(1);
  });

  it('部分词命中 → 命中比例', () => {
    expect(matchScore('quantum physics', 'quantum mechanics')).toBe(0.5);
  });

  it('无词命中 → 0', () => {
    expect(matchScore('biology', 'quantum computing')).toBe(0);
  });

  it('description 全是 <2 字符的词（无有效词）→ 0', () => {
    expect(matchScore('a b c', 'a b c')).toBe(0);
  });
});

describe('extractJSON', () => {
  it('纯 JSON 直接解析', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('```json 代码块', () => {
    expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('``` 无语言标记的代码块', () => {
    expect(extractJSON('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('文字包裹时按首尾花括号截取', () => {
    expect(extractJSON('结果如下：{"a":1} 完毕')).toEqual({ a: 1 });
  });

  it('找不到有效 JSON → 抛错', () => {
    expect(() => extractJSON('no json here')).toThrow('未找到有效 JSON');
  });
});

describe('MemoryAgentService.forget — design §3.6 数据安全契约', () => {
  // 最小 mock:findAll + deleteByTitle;systemConfigService 在 forget 路径里没用到,传空桩
  const mkSvc = (
    memories: Array<{ title: string; content: string }>,
    deleteSpy = jest.fn(),
  ) => {
    const memoryRepo = {
      findAll: jest.fn().mockResolvedValue(
        memories.map(
          (m) =>
            ({
              ...m,
              type: 'user',
              _id: m.title,
            }) as unknown as AgentMemory,
        ),
      ),
      deleteByTitle: deleteSpy,
    };
    // MemoryAgentService 现在需要 PromptManagerService(第三个参数),forget 不用 prompt,给空 mock
    return new MemoryAgentService(
      memoryRepo as never,
      {} as never, // systemConfigService 不参与 forget
      {} as never, // promptManager 不参与 forget
    );
  };

  it('库为空 → not_found,不调 deleteByTitle', async () => {
    const deleteSpy = jest.fn();
    const svc = mkSvc([], deleteSpy);
    const r = await svc.forget('什么');
    expect(r.status).toBe('not_found');
    expect(r.message).toMatch(/没有任何记忆/);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('库非空但 0 分匹配 → not_found,不调 deleteByTitle', async () => {
    const deleteSpy = jest.fn();
    const svc = mkSvc(
      [
        { title: '摄影偏好', content: '尼康相机' },
        { title: '饮食', content: '辣' },
      ],
      deleteSpy,
    );
    // target 的词都 <2 字符 → matchScore 返 0
    const r = await svc.forget('啊 哦');
    expect(r.status).toBe('not_found');
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('单条强命中 → ok + 调 deleteByTitle(原始标题)', async () => {
    const deleteSpy = jest.fn().mockResolvedValue(undefined);
    const svc = mkSvc(
      [
        { title: '摄影设备偏好', content: '尼康Z5' },
        { title: '饮食', content: '辣' },
      ],
      deleteSpy,
    );
    const r = await svc.forget('摄影设备偏好');
    expect(r.status).toBe('ok');
    expect(r.message).toMatch(/已忘记「摄影设备偏好」/);
    expect(deleteSpy).toHaveBeenCalledWith('摄影设备偏好');
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('多条强匹配(≥0.5)→ ambiguous,**不调 deleteByTitle**(数据安全核心)', async () => {
    const deleteSpy = jest.fn();
    const svc = mkSvc(
      [
        { title: '摄影偏好', content: '尼康' },
        { title: '摄影后期偏好', content: 'Lightroom' },
        { title: '饮食', content: '辣' },
      ],
      deleteSpy,
    );
    // "摄影偏好" 同时强匹配前两条
    const r = await svc.forget('摄影 偏好');
    expect(r.status).toBe('ambiguous');
    expect(r.message).toMatch(/匹配到多条,未删除/);
    expect(r.message).toMatch(/摄影偏好/);
    expect(r.message).toMatch(/摄影后期偏好/);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('并列最高分 → ambiguous,**不删**(消除唯一性歧义)', async () => {
    const deleteSpy = jest.fn();
    const svc = mkSvc(
      [
        { title: '偏好 A', content: 'A 内容' },
        { title: '偏好 B', content: 'B 内容' },
      ],
      deleteSpy,
    );
    // 只命中"偏好"一个词,A 和 B 拿到一样分数 → 并列最高
    const r = await svc.forget('偏好');
    expect(r.status).toBe('ambiguous');
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
