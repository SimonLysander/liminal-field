import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记路由为公开访问——全局 JwtAuthGuard 跳过强制鉴权。
 * 即使标记为 @Public()，Guard 仍会尝试解析 JWT 并挂载 request.user，
 * 供 controller/service 判断是否为管理员视角。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
