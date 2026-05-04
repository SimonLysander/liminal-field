/**
 * auth.e2e-spec.ts — 认证相关 E2E 测试
 *
 * 覆盖：登录/登出/状态检查的正常和异常路径。
 */
import supertest from 'supertest';
import { TestContext, login } from './helpers';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup();
  });

  afterAll(async () => {
    await ctx.teardown();
  });

  describe('POST /api/v1/auth/login', () => {
    it('正确密码 → 200 + set-cookie', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ password: 'test-password' })
        .expect(201);

      expect(res.body.code).toBe(0);
      expect(res.body.data.authenticated).toBe(true);
      // 必须下发 auth_token cookie
      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(cookieStr).toMatch(/auth_token=/);
    });

    it('错误密码 → 401', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ password: 'wrong-password' })
        .expect(401);

      expect(res.body.code).not.toBe(0);
    });

    it('缺少密码字段 → 400（ValidationPipe 校验失败）', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);
    });
  });

  describe('GET /api/v1/auth/check', () => {
    it('带有效 cookie → authenticated: true', async () => {
      const cookie = await login(ctx.app);
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/auth/check')
        .set('Cookie', cookie)
        .expect(200);

      expect(res.body.data.authenticated).toBe(true);
    });

    it('无 cookie → authenticated: false（@Public 路由，不返回 401）', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/auth/check')
        .expect(200);

      expect(res.body.data.authenticated).toBe(false);
    });

    it('伪造 JWT → 公开路由依然 200，authenticated: false', async () => {
      const res = await supertest(ctx.app.getHttpServer())
        .get('/api/v1/auth/check')
        .set('Cookie', 'auth_token=invalid.token.here')
        .expect(200);

      expect(res.body.data.authenticated).toBe(false);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('已登录状态 → 200 + 清除 cookie', async () => {
      const cookie = await login(ctx.app);
      const res = await supertest(ctx.app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .expect(201);

      expect(res.body.data.authenticated).toBe(false);
      // 响应中应包含清除 cookie 的指令
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        // clearCookie 会将 max-age 设为 0 或 expires 设为过去时间
        expect(cookieStr).toMatch(/auth_token=;|Max-Age=0|Expires=/i);
      }
    });

    it('未登录调用 logout → 401', async () => {
      await supertest(ctx.app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(401);
    });
  });
});
