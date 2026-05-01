import { Controller, Post, Req, Body, BadRequestException } from '@nestjs/common';
import { ImportService } from './import.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import type { MultipartFile } from '@fastify/multipart';

/**
 * ImportController — 文件导入 API
 *
 * 三步流程：parse → resolve-assets → confirm
 * 临时数据存 MinIO，confirm 后正式创建 content item。
 */
@Controller('spaces/notes/import')
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /** 解析上传的 .md 文件，返回转换结果和资源缺失列表 */
  @Post('parse')
  async parse(@Req() request: { file: () => Promise<MultipartFile | undefined> }) {
    const file = await request.file();
    if (!file) throw new BadRequestException('文件不能为空');

    const buffer = await file.toBuffer();
    return this.importService.parse(file.filename, buffer);
  }

  /** 用户上传文件夹内容，按文件名匹配缺失资源 */
  @Post('resolve-assets')
  async resolveAssets(
    @Req() request: { parts: () => AsyncIterableIterator<MultipartFile & { fieldname: string; value?: string }> },
  ) {
    let parseId = '';
    const files: { filename: string; buffer: Buffer; mimetype: string }[] = [];

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'parseId') {
          parseId = (part as unknown as { value: string }).value;
        }
      } else if (part.type === 'file') {
        const buffer = await part.toBuffer();
        files.push({
          filename: part.filename,
          buffer,
          mimetype: part.mimetype,
        });
      }
    }

    if (!parseId) throw new BadRequestException('parseId 不能为空');
    return this.importService.resolveAssets(parseId, files);
  }

  /** 确认导入，正式创建 content item 和 structure node */
  @Post('confirm')
  async confirm(@Body() dto: ConfirmImportDto) {
    return this.importService.confirm(dto);
  }
}
