/**
 * AgentMemoryRepository 集成测试 — 使用 mongodb-memory-server 真实测试数据库操作。
 *
 * 为什么不 mock Model：
 * - upsertSession/setTasks 依赖 Mongo partial unique index 保证"一草稿一条"的正确性，
 *   mock 无法覆盖索引约束，必须跑真实 MongoDB。
 * - mongodb-memory-server 在内存中启动真实 mongod，完全等价于生产行为，
 *   不依赖外部服务，适合 CI。
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { getModelForClass } from '@typegoose/typegoose';
import { AgentMemory } from './agent-memory.entity';
import { AgentMemoryRepository } from './agent-memory.repository';

let mongod: MongoMemoryServer;
let repo: AgentMemoryRepository;

beforeAll(async () => {
  // 启动内存 MongoDB，与 jest-e2e helpers.ts 保持一致的超时设置
  mongod = await MongoMemoryServer.create({
    instance: { launchTimeout: 120_000 },
  });
  await mongoose.connect(mongod.getUri());

  // 直接用 getModelForClass 创建 typegoose model（无需完整 NestJS DI）
  const memoryModel = getModelForClass(AgentMemory);

  // 确保 partial unique index 在测试 DB 中也被创建
  await memoryModel.ensureIndexes();

  // 构造 repository，绕过 DI 直接注入 model
  repo = new AgentMemoryRepository(memoryModel);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // 每个 test 前清空集合，保证隔离
  await mongoose.connection.collections['agent_lux_memories']?.deleteMany({});
});

// ─── upsertSession ───────────────────────────────────────────────────────────

describe('upsertSession', () => {
  it('首次 upsert → 创建一条 session 记忆', async () => {
    await repo.upsertSession('draft_abc', '初始内容');
    const doc = await repo.findSession('draft_abc');
    expect(doc).not.toBeNull();
    expect(doc!.type).toBe('session');
    expect(doc!.agentKey).toBe('draft_abc');
    expect(doc!.content).toBe('初始内容');
    expect(doc!.title).toBe('session:draft_abc');
    expect(doc!.tasks).toEqual([]);
  });

  it('同一 agentKey 重复 upsert → 只存一条，内容更新', async () => {
    await repo.upsertSession('draft_abc', '第一次');
    await repo.upsertSession('draft_abc', '第二次');

    const doc = await repo.findSession('draft_abc');
    expect(doc!.content).toBe('第二次');

    // partial unique index 保证只有一条（不新增）
    const total = await repo.count();
    expect(total).toBe(1);
  });

  it('不同 agentKey → 各自独立存储', async () => {
    await repo.upsertSession('draft_aaa', '草稿A');
    await repo.upsertSession('draft_bbb', '草稿B');

    const docA = await repo.findSession('draft_aaa');
    const docB = await repo.findSession('draft_bbb');
    expect(docA!.content).toBe('草稿A');
    expect(docB!.content).toBe('草稿B');

    const total = await repo.count();
    expect(total).toBe(2);
  });
});

// ─── findSession ─────────────────────────────────────────────────────────────

describe('findSession', () => {
  it('不存在的 agentKey → 返回 null', async () => {
    const result = await repo.findSession('nonexistent');
    expect(result).toBeNull();
  });

  it('存在时返回完整文档', async () => {
    await repo.upsertSession('draft_xyz', 'hello world');
    const doc = await repo.findSession('draft_xyz');
    expect(doc).toBeDefined();
    expect(doc!.content).toBe('hello world');
    expect(doc!.agentKey).toBe('draft_xyz');
  });
});

// ─── setTasks / getTasks ─────────────────────────────────────────────────────

describe('setTasks / getTasks', () => {
  const sampleTasks = [
    { id: 't1', title: '任务一', status: 'pending' },
    { id: 't2', title: '任务二', status: 'done' },
  ];

  it('setTasks → getTasks 往返正确', async () => {
    await repo.upsertSession('draft_tasks', '写作中');
    await repo.setTasks('draft_tasks', sampleTasks);

    const tasks = await repo.getTasks('draft_tasks');
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ id: 't1', status: 'pending' });
    expect(tasks[1]).toMatchObject({ id: 't2', status: 'done' });
  });

  it('getTasks — session 不存在 → 返回空数组', async () => {
    const tasks = await repo.getTasks('no_such_draft');
    expect(tasks).toEqual([]);
  });

  it('setTasks — session 不存在时自动 upsert 创建记录', async () => {
    // setTasks 内部也做 upsert，不依赖先调 upsertSession
    await repo.setTasks('draft_new', sampleTasks);
    const tasks = await repo.getTasks('draft_new');
    expect(tasks).toHaveLength(2);

    // 验证创建的文档结构完整
    const doc = await repo.findSession('draft_new');
    expect(doc!.type).toBe('session');
    expect(doc!.agentKey).toBe('draft_new');
  });

  it('多次 setTasks → 最新值覆盖旧值', async () => {
    await repo.upsertSession('draft_update', '正文');
    await repo.setTasks('draft_update', sampleTasks);
    await repo.setTasks('draft_update', [{ id: 't3', title: '新任务' }]);

    const tasks = await repo.getTasks('draft_update');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: 't3' });
  });
});

// ─── 与现有 user 类型共存(渐进式兼容) ──────────────────────────────────────

describe('session 与 user 类型共存', () => {
  it('upsert user 记忆后 upsertSession 互不干扰', async () => {
    // 现有 user 记忆写入
    await repo.upsert({
      type: 'user',
      title: '用户画像',
      content: '偏好：简洁',
    });

    // session 写入
    await repo.upsertSession('draft_coexist', '会话记忆');

    const total = await repo.count();
    expect(total).toBe(2);

    // user 记忆不受影响
    const userMems = await repo.findByTypes(['user']);
    expect(userMems).toHaveLength(1);
    expect(userMems[0].title).toBe('用户画像');

    // session 独立
    const sessionDoc = await repo.findSession('draft_coexist');
    expect(sessionDoc!.content).toBe('会话记忆');
  });
});
