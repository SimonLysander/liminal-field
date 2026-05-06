import 'fastify';

// guard 通过后 user.sub 一定存在，类型反映这一不变量
/** JWT payload 结构；sub/iat/exp 由签发保证必存在，role 为可选权限字段。 */
export interface AuthenticatedUser {
  sub: string;
  iat: number;
  exp: number;
  role?: string;
}

/** JwtAuthGuard 注入；与 @fastify/cookie 的 cookies 并存由 interface merge 完成 */
declare module 'fastify' {
  interface FastifyRequest {
    /** JwtAuthGuard 在 verify 成功后挂载 */
    user?: AuthenticatedUser;
    /** @fastify/cookie；声明便于在无插件类型时通过校验 */
    cookies?: Record<string, string | undefined>;
  }
}
