/**
 * InfoSourceController — 信息源 CRUD REST API。
 *
 * 路径前缀: /info-sources（全局共用资源，与 SkillController 同层独立）
 * 权限: 默认全局 JwtAuthGuard，无 @Public()
 *
 * 端点:
 *   GET    /info-sources        list
 *   GET    /info-sources/:id    get
 *   POST   /info-sources        create (400 url 非法 / 400 type 不支持)
 *   PATCH  /info-sources/:id    update (404 找不到)
 *   DELETE /info-sources/:id    delete (TODO task#35 依赖检查)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { InfoSourceService } from './info-source.service';
import {
  CreateInfoSourceDto,
  UpdateInfoSourceDto,
} from './dto/info-source.dto';

@Controller('info-sources')
export class InfoSourceController {
  private readonly logger = new Logger(InfoSourceController.name);

  constructor(private readonly infoSourceService: InfoSourceService) {}

  @Get()
  list() {
    return this.infoSourceService.list();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.infoSourceService.getById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateInfoSourceDto) {
    this.logger.debug(`POST /info-sources type=${dto.type} name=${dto.name}`);
    return this.infoSourceService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInfoSourceDto) {
    this.logger.debug(`PATCH /info-sources/${id}`);
    return this.infoSourceService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    this.logger.debug(`DELETE /info-sources/${id}`);
    await this.infoSourceService.delete(id);
  }
}
