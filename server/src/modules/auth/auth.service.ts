import { Injectable, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService implements OnModuleInit {
  private passwordHash!: string;

  async onModuleInit(): Promise<void> {
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
}
