/**
 * SkillController — 全局 Skill 管理 REST API。
 *
 * 路径前缀:/admin/skills
 * 权限:默认走全局 JwtAuthGuard(单一 owner 体系,跟 SettingsController 同款)
 *      —— 不挂 @Public(),不另设 RolesGuard。
 *
 * 端点:
 *   GET    /admin/skills        list
 *   POST   /admin/skills        create(409 重名)
 *   PUT    /admin/skills/:id    update(404 找不到 / 409 改 name 撞)
 *   DELETE /admin/skills/:id    delete(幂等,事件触发级联清理)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { SkillService } from './skill.service';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';

@Controller('admin/skills')
export class SkillController {
  private readonly logger = new Logger(SkillController.name);

  constructor(private readonly skillService: SkillService) {}

  @Get()
  list() {
    return this.skillService.list();
  }

  @Post()
  create(@Body() dto: CreateSkillDto) {
    this.logger.debug(`POST /admin/skills name=${dto.name}`);
    return this.skillService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSkillDto) {
    this.logger.debug(`PUT /admin/skills/${id}`);
    return this.skillService.update(id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<{ ok: true }> {
    this.logger.debug(`DELETE /admin/skills/${id}`);
    await this.skillService.delete(id);
    return { ok: true };
  }
}
