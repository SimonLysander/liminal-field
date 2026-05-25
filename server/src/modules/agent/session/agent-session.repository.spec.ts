/**
 * AgentSession 分段读写契约测试。
 *
 * 为什么分段：MongoDB 单文档 16MB 上限，长对话 messages append-only 会撞上限。
 * 解决方案：同一 agentKey 按 segIndex 分段存储，前端跨段聚合，用户无感。
 *
 * 测试覆盖：appendMessages 建 seg0 / push 追加、getRecentMessages 跨段倒取、
 * getAllMessages 跨段正序、deleteByAgentKey 全段清除。
 *
 * 注意：14MB 软上限阈值测试依赖大量内存数据造段，实测难以构造，此处不覆盖；
 * 分段切换逻辑在 appendMessages 实现中通过常量 SEG_SOFT_LIMIT_BYTES 控制。
 */
import { getModelToken } from 'nestjs-typegoose';
import { Test, TestingModule } from '@nestjs/testing';
import { TypegooseModule } from 'nestjs-typegoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Types } from 'mongoose';
import { AgentSessionRepository } from './agent-session.repository';
import { AgentSession } from './agent-session.entity';

describe('AgentSessionRepository — 分段读写', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let repo: AgentSessionRepository;

  beforeAll(async () => {
    // 启动内存 MongoDB，与 test/helpers.ts 保持一致的超时配置
    mongod = await MongoMemoryServer.create({
      instance: { launchTimeout: 120_000 },
    });
    const mongoUri = mongod.getUri();

    moduleRef = await Test.createTestingModule({
      imports: [
        TypegooseModule.forRoot(mongoUri),
        TypegooseModule.forFeature([AgentSession]),
      ],
      providers: [AgentSessionRepository],
    }).compile();

    repo = moduleRef.get(AgentSessionRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  // 每个 test case 使用独立 agentKey，互不干扰
  const key = (suffix: string) => `draft-test-${suffix}`;

  describe('appendMessages', () => {
    it('首次追加时自动建 seg0', async () => {
      const agentKey = key('append-init');
      await repo.appendMessages(agentKey, [{ role: 'user', content: 'hello' }]);

      const seg = await repo.findLatestSeg(agentKey);
      expect(seg).not.toBeNull();
      expect(seg!.segIndex).toBe(0);
      expect(seg!.agentKey).toBe(agentKey);
      expect(seg!.messages).toHaveLength(1);
      expect(seg!.messages[0]).toMatchObject({
        role: 'user',
        content: 'hello',
      });
    });

    it('多次追加都进同一个 seg（未触发软上限）', async () => {
      const agentKey = key('append-multi');
      const msgs = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'reply1' },
        { role: 'user', content: 'msg2' },
      ];

      for (const msg of msgs) {
        await repo.appendMessages(agentKey, [msg]);
      }

      const seg = await repo.findLatestSeg(agentKey);
      expect(seg!.segIndex).toBe(0);
      expect(seg!.messages).toHaveLength(3);
    });

    it('批量追加多条消息', async () => {
      const agentKey = key('append-batch');
      const batch = [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ];
      await repo.appendMessages(agentKey, batch);

      const seg = await repo.findLatestSeg(agentKey);
      expect(seg!.messages).toHaveLength(2);
    });
  });

  describe('findLatestSeg', () => {
    it('agentKey 不存在时返回 null', async () => {
      const seg = await repo.findLatestSeg('nonexistent-key-xyz');
      expect(seg).toBeNull();
    });

    it('多段时返回 segIndex 最大的段', async () => {
      const agentKey = key('latest-seg');
      // 手动构造两段（直接写 model，绕过 appendMessages 逻辑）
      const model = moduleRef.get(getModelToken(AgentSession.name));
      const now = new Date();
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 0,
        messages: [{ role: 'user', content: 'seg0' }],
        createdAt: now,
        lastActiveAt: now,
      });
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 1,
        messages: [{ role: 'user', content: 'seg1' }],
        createdAt: now,
        lastActiveAt: now,
      });

      const seg = await repo.findLatestSeg(agentKey);
      expect(seg!.segIndex).toBe(1);
    });
  });

  describe('getRecentMessages', () => {
    it('单段内取最近 N 条（正序返回）', async () => {
      const agentKey = key('recent-single');
      const allMsgs = [
        { role: 'user', content: '1' },
        { role: 'assistant', content: '2' },
        { role: 'user', content: '3' },
        { role: 'user', content: '4' },
      ];
      await repo.appendMessages(agentKey, allMsgs);

      const recent = await repo.getRecentMessages(agentKey, 2);
      // 取最近 2 条，结果正序（旧→新）
      expect(recent).toHaveLength(2);
      expect(recent[0]).toMatchObject({ content: '3' });
      expect(recent[1]).toMatchObject({ content: '4' });
    });

    it('跨两段取最近 N 条（优先新段消息）', async () => {
      const agentKey = key('recent-multi');
      const model = moduleRef.get(getModelToken(AgentSession.name));
      const now = new Date();
      // seg0: 2 条
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 0,
        messages: [
          { role: 'user', content: 'seg0-a' },
          { role: 'assistant', content: 'seg0-b' },
        ],
        createdAt: now,
        lastActiveAt: now,
      });
      // seg1: 2 条
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 1,
        messages: [
          { role: 'user', content: 'seg1-a' },
          { role: 'assistant', content: 'seg1-b' },
        ],
        createdAt: now,
        lastActiveAt: now,
      });

      // 取最近 3 条：应该是 seg0-b + seg1-a + seg1-b（正序）
      const recent = await repo.getRecentMessages(agentKey, 3);
      expect(recent).toHaveLength(3);
      expect(recent[0]).toMatchObject({ content: 'seg0-b' });
      expect(recent[1]).toMatchObject({ content: 'seg1-a' });
      expect(recent[2]).toMatchObject({ content: 'seg1-b' });
    });

    it('limit 大于总条数时返回全部', async () => {
      const agentKey = key('recent-overflow');
      await repo.appendMessages(agentKey, [{ role: 'user', content: 'only' }]);

      const recent = await repo.getRecentMessages(agentKey, 100);
      expect(recent).toHaveLength(1);
    });
  });

  describe('getAllMessages', () => {
    it('单段返回全部消息（正序）', async () => {
      const agentKey = key('all-single');
      const msgs = [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ];
      await repo.appendMessages(agentKey, msgs);

      const all = await repo.getAllMessages(agentKey);
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ content: 'first' });
      expect(all[1]).toMatchObject({ content: 'second' });
    });

    it('跨段返回全部消息（按 segIndex 正序拼接）', async () => {
      const agentKey = key('all-multi');
      const model = moduleRef.get(getModelToken(AgentSession.name));
      const now = new Date();
      // 故意以乱序插入，验证 sort 正确
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 1,
        messages: [{ role: 'user', content: 'seg1' }],
        createdAt: now,
        lastActiveAt: now,
      });
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 0,
        messages: [{ role: 'user', content: 'seg0' }],
        createdAt: now,
        lastActiveAt: now,
      });

      const all = await repo.getAllMessages(agentKey);
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ content: 'seg0' });
      expect(all[1]).toMatchObject({ content: 'seg1' });
    });

    it('agentKey 不存在时返回空数组', async () => {
      const all = await repo.getAllMessages('no-such-agent');
      expect(all).toEqual([]);
    });
  });

  describe('deleteByAgentKey', () => {
    it('删除全部段，findLatestSeg 返回 null', async () => {
      const agentKey = key('delete-all');
      const model = moduleRef.get(getModelToken(AgentSession.name));
      const now = new Date();
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 0,
        messages: [],
        createdAt: now,
        lastActiveAt: now,
      });
      await model.create({
        _id: new Types.ObjectId(),
        agentKey,
        segIndex: 1,
        messages: [],
        createdAt: now,
        lastActiveAt: now,
      });

      await repo.deleteByAgentKey(agentKey);

      const seg = await repo.findLatestSeg(agentKey);
      expect(seg).toBeNull();
    });

    it('agentKey 不存在时不抛异常', async () => {
      await expect(repo.deleteByAgentKey('ghost-agent')).resolves.not.toThrow();
    });
  });
});
