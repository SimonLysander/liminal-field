import 'fastify';

/** JwtAuthGuard 注入；与 @fastify/cookie 的 cookies 并存由 interface merge 完成 */
declare module 'fastify' {
  interface FastifyRequest {
    /** JwtAuthGuard 在 verify 成功后挂载 */
    user?: { role?: string; sub?: string; iat?: number; exp?: number };
    /** @fastify/cookie；声明便于在无插件类型时通过校验 */
    cookies?: Record<string, string | undefined>;
  }
}
