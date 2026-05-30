import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { SystemConfigRepository } from '../settings/system-config.repository';

/**
 * AuthService — 管理员认证。
 *
 * 密码优先级：MongoDB（用户改过的）> env（初始默认值）。
 * 设备信任：生成随机 token + 设备信息，存 MongoDB。
 */
@Injectable()
export class AuthService implements OnModuleInit {
  private passwordHash!: string;

  constructor(private readonly configRepo: SystemConfigRepository) {}

  async onModuleInit(): Promise<void> {
    const config = await this.configRepo.get();
    if (config?.passwordHash) {
      this.passwordHash = config.passwordHash;
      return;
    }

    const password = process.env.ADMIN_PASSWORD;
    if (!password) {
      throw new Error(
        'ADMIN_PASSWORD environment variable is required — server cannot start without it',
      );
    }
    this.passwordHash = await bcrypt.hash(password, 10);
  }

  async validatePassword(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  }

  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<boolean> {
    const valid = await bcrypt.compare(currentPassword, this.passwordHash);
    if (!valid) return false;

    this.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.configRepo.patch({ passwordHash: this.passwordHash });
    return true;
  }

  /** 信任设备：存 token + 设备信息 */
  async trustDevice(userAgent: string): Promise<string> {
    const token = randomUUID();
    const name = this.parseDeviceName(userAgent);

    const config = await this.configRepo.get();
    const devices = config?.trustedDevices ?? [];

    // 同设备(按 parseDeviceName 指纹)已信任过 → 复用该条记录、轮换 token、
    // 刷新 trustedAt; 避免每次登录无脑 push 新条目(过去同台 Mac + Chrome
    // 反复登录会积累一堆同名 record,见 SecurityTab 列表)。
    // lastUsedAt 不动:其语义是"此设备最近访问"、与 token 轮换无关。
    const existing = devices.find((d) => d.name === name);
    if (existing) {
      existing.token = token;
      existing.userAgent = userAgent;
      existing.trustedAt = new Date();
    } else {
      devices.push({
        token,
        name,
        userAgent,
        trustedAt: new Date(),
      });
    }

    await this.configRepo.patch({ trustedDevices: devices });
    return token;
  }

  /** 验证设备 token，成功时更新 lastUsedAt */
  async validateDeviceToken(token: string): Promise<boolean> {
    const config = await this.configRepo.get();
    const devices = config?.trustedDevices ?? [];
    const device = devices.find((d) => d.token === token);
    if (!device) return false;

    // 更新最后使用时间
    device.lastUsedAt = new Date();
    await this.configRepo.patch({ trustedDevices: devices });
    return true;
  }

  /** 获取所有受信任设备（脱敏，不返回 token） */
  async listDevices(): Promise<
    Array<{
      id: string;
      name: string;
      trustedAt: string;
      lastUsedAt: string | null;
    }>
  > {
    const config = await this.configRepo.get();
    return (config?.trustedDevices ?? []).map((d) => ({
      // 用 token 前 8 位作为 ID（前端用于撤销），不暴露完整 token
      id: d.token.slice(0, 8),
      name: d.name,
      trustedAt: d.trustedAt.toISOString(),
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
    }));
  }

  /** 撤销单个设备 */
  async revokeDevice(idPrefix: string): Promise<boolean> {
    const config = await this.configRepo.get();
    const devices = config?.trustedDevices ?? [];
    const filtered = devices.filter((d) => !d.token.startsWith(idPrefix));
    if (filtered.length === devices.length) return false;
    await this.configRepo.patch({ trustedDevices: filtered });
    return true;
  }

  /** 撤销所有设备信任 */
  async revokeAllDevices(): Promise<void> {
    await this.configRepo.patch({ trustedDevices: [] });
  }

  /** 从 User-Agent 解析设备 + 浏览器名称 */
  private parseDeviceName(ua: string): string {
    let os = '未知设备';
    if (/Macintosh/.test(ua)) os = 'Mac';
    else if (/Windows/.test(ua)) os = 'Windows';
    else if (/iPhone/.test(ua)) os = 'iPhone';
    else if (/iPad/.test(ua)) os = 'iPad';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/Linux/.test(ua)) os = 'Linux';

    let browser = '';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';

    return browser ? `${os} · ${browser}` : os;
  }
}
