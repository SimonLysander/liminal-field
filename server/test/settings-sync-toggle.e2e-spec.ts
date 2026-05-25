/**
 * settings-sync-toggle.e2e-spec.ts —— 同步开关(gitSyncEnabled)端到端回归。
 *
 * 验证「设置→同步→同步开关」这条链路:
 * - 默认开启(gitSyncEnabled 缺省视为 true)
 * - PUT sync-config 关闭后:配置视图持久化为 false,且 GIT_SYNC_ENABLED 环境变量同步为 'false'
 * - 关闭状态下手动推送(POST push-to-remote)被拦截,返回"同步已关闭,跳过推送"(不真正联远端)
 * - 再次开启后配置视图恢复 true
 *
 * 这套保的是用户那次「已关闭同步却仍推送」bug 的回归:开关必须真正阻断 push。
 */
import supertest from 'supertest';
import { TestContext, login } from './helpers';
import { SettingsModule } from '../src/modules/settings/settings.module';

describe('同步开关 sync toggle (e2e)', () => {
  let ctx: TestContext;
  let cookie: string;

  beforeAll(async () => {
    ctx = new TestContext();
    await ctx.setup([SettingsModule]);
    cookie = await login(ctx.app);
  });

  afterAll(async () => {
    // 还原环境变量,避免污染同进程后续(本套件 maxWorkers=1、文件级独立进程,稳妥起见仍清理)
    delete process.env.GIT_SYNC_ENABLED;
    await ctx.teardown();
  });

  const getSync = async () => {
    const res = await supertest(ctx.app.getHttpServer())
      .get('/api/v1/settings/config')
      .set('Cookie', cookie)
      .expect(200);
    // 响应统一包装 { code, msg, data }
    return res.body.data.sync as { gitSyncEnabled: boolean };
  };

  const setSyncEnabled = (gitSyncEnabled: boolean) =>
    supertest(ctx.app.getHttpServer())
      .put('/api/v1/settings/sync-config')
      .set('Cookie', cookie)
      // url 必填(saveSyncConfig 签名),置空即可——本用例不联真实远端
      .send({ url: '', gitSyncEnabled })
      .expect(200);

  it('默认同步开启(gitSyncEnabled=true)', async () => {
    expect((await getSync()).gitSyncEnabled).toBe(true);
  });

  it('关闭同步 → 配置持久化为 false,且 GIT_SYNC_ENABLED 环境变量=false', async () => {
    await setSyncEnabled(false);
    expect((await getSync()).gitSyncEnabled).toBe(false);
    expect(process.env.GIT_SYNC_ENABLED).toBe('false');
  });

  it('同步关闭时手动推送被拦截,返回"同步已关闭"且不联远端', async () => {
    // 前置:确保处于关闭态
    await setSyncEnabled(false);
    const res = await supertest(ctx.app.getHttpServer())
      .post('/api/v1/settings/push-to-remote')
      .set('Cookie', cookie)
      .expect(201);
    expect(res.body.data.success).toBe(true);
    expect(res.body.data.message).toContain('同步已关闭');
  });

  it('重新开启同步 → 配置恢复 true', async () => {
    await setSyncEnabled(true);
    expect((await getSync()).gitSyncEnabled).toBe(true);
    expect(process.env.GIT_SYNC_ENABLED).toBe('true');
  });
});
