import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = (request as any).cookies?.['auth_token'];

    if (token) {
      try {
        (request as any).user = this.jwtService.verify(token);
      } catch {
        if (!isPublic) {
          throw new UnauthorizedException('登录态已过期');
        }
      }
    } else if (!isPublic) {
      throw new UnauthorizedException('需要登录');
    }

    return true;
  }
}
