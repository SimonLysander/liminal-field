/**
 * SSE 端到端冒烟测试：验证 NestJS @Sse() + EventEmitter 推送子 agent 进度。
 */
import { TestContext, login } from './helpers';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('Sub-agent SSE progress (E2E)', () => {
  const ctx = new TestContext();
  let cookie: string;
  let baseUrl: string;

  beforeAll(async () => {
    await ctx.setup();
    cookie = await login(ctx.app);
    const server = ctx.app.getHttpServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' ? address!.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 120_000);

  afterAll(async () => {
    await ctx.teardown();
  });

  it('SSE 应推送 step 和 done 事件', async () => {
    const sessionKey = 'test-sse-smoke';
    const eventEmitter = ctx.app.get(EventEmitter2);

    // 1. 连接 SSE
    const res = await fetch(
      `${baseUrl}/api/v1/agent/sub-agent-progress?sessionKey=${sessionKey}`,
      { headers: { Cookie: cookie } },
    );
    expect(res.status).toBe(200);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // 2. 等连接稳定后发事件
    await new Promise((r) => setTimeout(r, 200));

    eventEmitter.emit('sub-agent.step', {
      sessionKey,
      step: 1,
      tools: [{ name: 'search_knowledge_base', args: '量子计算' }],
    });

    await new Promise((r) => setTimeout(r, 100));

    eventEmitter.emit('sub-agent.done', { sessionKey });

    // 3. 累积读取所有 chunks 直到 stream 关闭
    let allText = '';
    for (let i = 0; i < 10; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      allText += decoder.decode(value);
      if (allText.includes('"done"')) break;
    }

    // 4. 验证包含 step 和 done 数据
    expect(allText).toContain('search_knowledge_base');
    expect(allText).toContain('done');
  }, 10_000);
});
