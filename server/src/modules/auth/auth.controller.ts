import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { ContentGitService } from '../content/content-git.service';

const COOKIE_NAME = 'auth_token';
const COOKIE_PATH = '/api';

/** @fastify/cookie 在运行时挂载；isolatedModules 下用窄接口代替 any */
type ReplyWithCookie = FastifyReply & {
  setCookie(
    name: string,
    value: string,
    options?: Record<string, unknown>,
  ): void;
  clearCookie(name: string, options?: Record<string, unknown>): void;
};

function asCookieReply(reply: FastifyReply): ReplyWithCookie {
  return reply;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly contentGitService: ContentGitService,
  ) {}

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const valid = await this.authService.validatePassword(dto.password);
    if (!valid) {
      throw new UnauthorizedException('密码错误');
    }

    const token = this.jwtService.sign({ role: 'admin' });
    asCookieReply(reply).setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: COOKIE_PATH,
      maxAge: 7 * 24 * 60 * 60,
    });

    return { authenticated: true };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) reply: FastifyReply) {
    asCookieReply(reply).clearCookie(COOKIE_NAME, { path: COOKIE_PATH });
    return { authenticated: false };
  }

  @Public()
  @Get('check')
  check(@Req() request: FastifyRequest) {
    return { authenticated: !!request.user };
  }

  @Get('sync-status')
  async getSyncStatus() {
    return this.contentGitService.getSyncStatus();
  }

  @Post('sync')
  async syncToRemote() {
    return this.contentGitService.pushCurrentBranch();
  }
}
