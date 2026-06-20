/**
 * PromptManagerModule — 全局 prompt 管理模块。
 *
 * @Global() 使 PromptManagerService 无需逐 module import 即可注入，
 * 统一 app.module.ts 里导入一次即可。
 */
import { Global, Module } from '@nestjs/common';
import { PromptManagerService } from './prompt-manager.service';

@Global()
@Module({
  providers: [PromptManagerService],
  exports: [PromptManagerService],
})
export class PromptManagerModule {}
