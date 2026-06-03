/**
 * SkillModule — 全局 Skill 池模块。
 *
 * 依赖:仅 TypegooseModule 注册 Skill collection;EventEmitter2 走全局
 * (AgentModule 已 EventEmitterModule.forRoot,Nest 默认全局可用)。
 *
 * 导出 SkillService 给:
 *   - SettingsService(Task 0.5 配置时校验 + Task 0.6 监听 skill.deleted)
 *   - AgentModule(Phase 1 prompt.handler 注入 + tool.assembler 挂 Skill tool)
 */
import { Module } from '@nestjs/common';
import { TypegooseModule } from 'nestjs-typegoose';
import { Skill } from './skill.entity';
import { SkillRepository } from './skill.repository';
import { SkillService } from './skill.service';
import { SkillController } from './skill.controller';

@Module({
  imports: [TypegooseModule.forFeature([Skill])],
  controllers: [SkillController],
  providers: [SkillRepository, SkillService],
  exports: [SkillService, SkillRepository],
})
export class SkillModule {}
