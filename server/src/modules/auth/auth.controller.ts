import {
  Body,
  Controller,
  Get,
  Logger,
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
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  /** 设置 JWT cookie 的公共逻辑 */
  private setAuthCookie(reply: FastifyReply): void {
    const token = this.jwtService.sign({ role: 'admin' });
    asCookieReply(reply).setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure:
        process.env.COOKIE_SECURE !== 'false' &&
        process.env.NODE_ENV === 'production',
      path: COOKIE_PATH,
      maxAge: 7 * 24 * 60 * 60,
    });
  }

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

    this.setAuthCookie(reply);
    return { authenticated: true };
  }

  /** 设备 token 免密登录 */
  @Public()
  @Post('device-login')
  async deviceLogin(
    @Body() dto: { deviceToken: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const valid = await this.authService.validateDeviceToken(dto.deviceToken);
    if (!valid) {
      throw new UnauthorizedException('设备令牌无效');
    }

    this.setAuthCookie(reply);
    return { authenticated: true };
  }

  /** 信任当前设备（需已登录），返回设备 token 供客户端存储 */
  @Post('trust-device')
  async trustDevice(@Req() request: FastifyRequest) {
    const ua = request.headers['user-agent'] ?? '';
    const token = await this.authService.trustDevice(ua);
    return { deviceToken: token };
  }

  /** 受信任设备列表 */
  @Get('devices')
  async listDevices() {
    return this.authService.listDevices();
  }

  /** 撤销单个设备 */
  @Post('revoke-device')
  async revokeDevice(@Body() dto: { id: string }) {
    const success = await this.authService.revokeDevice(dto.id);
    return { success };
  }

  /** 撤销所有设备信任 */
  @Post('revoke-devices')
  async revokeDevices() {
    await this.authService.revokeAllDevices();
    return { success: true };
  }

  @Post('change-password')
  async changePassword(
    @Body() dto: { currentPassword: string; newPassword: string },
  ) {
    if (!dto.newPassword || dto.newPassword.length < 6) {
      throw new UnauthorizedException('新密码至少 6 个字符');
    }
    const success = await this.authService.changePassword(
      dto.currentPassword,
      dto.newPassword,
    );
    if (!success) {
      throw new UnauthorizedException('当前密码错误');
    }
    return { success: true };
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
}
