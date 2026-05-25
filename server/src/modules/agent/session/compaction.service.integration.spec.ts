/**
 * CompactionService.compactIfNeeded 行为契约测试(新架构)。
 *
 * 锁定三条关键不变量:
 * 1. token 触发:总上下文未超窗口 60% 时不压缩;超了才把最老的对话提炼。
 * 2. 原文不删:compaction 后 messages 各段原文条数不变(只追加,永不覆盖删除)。
 * 3. 委托提炼:触发后调用 MemoryAgentService.compact(agentKey, toCompact, prevContent)。
 *
 * 用真实 repository + mongodb-memory-server 验证 DB 副作用;LLM 调用(MemoryAgentService.compact)mock 掉。
 */
import { Test, TestingModule } from '@nestjs/testing';
import { TypegooseModule } from 'nestjs-typegoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { CompactionService } from './compaction.service';
import { AgentSessionRepository } from './agent-session.repository';
import { AgentSession } from './agent-session.entity';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import { AgentMemory } from '../memory/agent-memory.entity';
import { MemoryAgentService } from '../memory/memory-agent.service';

describe('CompactionService.compactIfNeeded — token 触发 + 原文不删', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: CompactionService;
  let sessionRepo: AgentSessionRepository;
  let memoryRepo: AgentMemoryRepository;
  // 记录 compact 调用,验证委托参数;不真打 LLM
  let compactSpy: jest.Mock;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create({
      instance: { launchTimeout: 120_000 },
    });
    compactSpy = jest.fn().mockResolvedValue({ memoriesExtracted: 0 });

    moduleRef = await Test.createTestingModule({
      imports: [
        TypegooseModule.forRoot(mongod.getUri()),
        TypegooseModule.forFeature([AgentSession, AgentMemory]),
      ],
      providers: [
        CompactionService,
        AgentSessionRepository,
        AgentMemoryRepository,
        // 替身:MemoryAgentService.compact 不真调 LLM,只记录调用
        { provide: MemoryAgentService, useValue: { compact: compactSpy } },
      ],
    }).compile();

    service = moduleRef.get(CompactionService);
    sessionRepo = moduleRef.get(AgentSessionRepository);
    memoryRepo = moduleRef.get(AgentMemoryRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  beforeEach(() => compactSpy.mockClear());

  const key = (s: string) => `draft-compact-${s}`;

  it('总占比未超 60%:不触发 compact', async () => {
    const agentKey = key('under-trigger');
    await sessionRepo.appendMessages(agentKey, [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好,有什么可以帮你' },
    ]);

    // 窗口 100000,两条短消息远未到 60%
    await service.compactIfNeeded(agentKey, 100000);

    expect(compactSpy).not.toHaveBeenCalled();
  });

  it('总占比超 60%:触发 compact,且原文一条不少', async () => {
    const agentKey = key('over-trigger');
    // 小窗口 + 大量长消息,使总 token 轻松超 60%
    const big = '稿'.repeat(500); // 纯中文 ~500 token/条
    const msgs = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: big,
    }));
    await sessionRepo.appendMessages(agentKey, msgs);

    const beforeCount = (await sessionRepo.getAllMessages(agentKey)).length;
    expect(beforeCount).toBe(20);

    await service.compactIfNeeded(agentKey, 2000);

    // 触发了提炼
    expect(compactSpy).toHaveBeenCalledTimes(1);
    // 委托参数:agentKey + 一段 toCompact(最老的若干条) + prevContent(此处空字符串)
    const [calledKey, toCompact, prevContent] = compactSpy.mock.calls[0];
    expect(calledKey).toBe(agentKey);
    expect(Array.isArray(toCompact)).toBe(true);
    expect((toCompact as unknown[]).length).toBeGreaterThan(0);
    expect((toCompact as unknown[]).length).toBeLessThan(20); // 最近的保留,不全压
    expect(prevContent).toBe('');

    // 关键:原文一条不少(append-only,compaction 绝不删原文)
    const afterCount = (await sessionRepo.getAllMessages(agentKey)).length;
    expect(afterCount).toBe(20);
  });

  it('固定开销(user 记忆 + session content)计入分母,推高触发概率', async () => {
    const agentKey = key('fixed-tokens');
    // 先放一条已有 session 记忆 content(进固定开销 F)
    await memoryRepo.upsertSession(agentKey, '历'.repeat(400));
    // 再放一条大 user 记忆(进固定开销 F)
    await memoryRepo.upsert({
      type: 'user',
      title: '画像',
      content: '景'.repeat(400),
    });
    // 对话本身不算特别长,但叠加固定开销后总占比够触发
    const msgs = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: '文'.repeat(200),
    }));
    await sessionRepo.appendMessages(agentKey, msgs);

    await service.compactIfNeeded(agentKey, 2000);

    // 触发,且 prevContent 带上了已有 session 记忆 content(供 LLM 合并)
    expect(compactSpy).toHaveBeenCalledTimes(1);
    const [, , prevContent] = compactSpy.mock.calls[0];
    expect(typeof prevContent).toBe('string');
    expect((prevContent as string).length).toBeGreaterThan(0);
  });
});
