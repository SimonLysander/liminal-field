import {
  Controller,
  Delete,
  Post,
  Get,
  Param,
  Req,
  Res,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { extname } from 'node:path';
import { RawResponse } from '../../common/raw-response.decorator';
import { ImportService } from './import.service';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { BatchConfirmDto } from './dto/batch-confirm.dto';
import type { FastifyReply } from 'fastify';

/** import 路由用的 multipart 形状（与 @fastify/multipart 一致，避免包类型解析失败） */
type MultipartFilePart = {
  type: 'file';
  /** 表单字段名（如 'archive'、'file'）——对应 @fastify/multipart MultipartFile.fieldname */
  fieldname: string;
  filename: string;
  mimetype: string;
  toBuffer(): Promise<Buffer>;
};

type MultipartFieldPart = {
  type: 'field';
  fieldname: string;
  value?: string;
};

type MultipartIterableRequest = {
  file(): Promise<MultipartFilePart | undefined>;
  parts(): AsyncIterableIterator<MultipartFilePart | MultipartFieldPart>;
};

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
  async parse(@Req() request: MultipartIterableRequest) {
    const file = await request.file();
    if (!file) throw new BadRequestException('文件不能为空');

    // 安全：限制上传文件类型，防止任意文件写入存储
    const ALLOWED_EXTENSIONS = new Set([
      '.md',
      '.pdf',
      '.docx',
      '.doc',
      '.pptx',
      '.ppt',
    ]);
    const ext = extname(file.filename).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        '不支持的文件格式，仅支持 .md / .pdf / .docx / .doc / .pptx / .ppt',
      );
    }

    const buffer = await file.toBuffer();
    return this.importService.parse(file.filename, buffer);
  }

  /** 获取解析结果（预览页加载 / 页面刷新时从 MinIO 读取） */
  @Get('parse/:parseId')
  async getParse(@Param('parseId') parseId: string) {
    return this.importService.getParse(parseId);
  }

  /** 预览阶段提供图片访问（从 MinIO 临时目录读取） */
  @RawResponse()
  @Get('parse/:parseId/assets/:fileName')
  async servePreviewAsset(
    @Param('parseId') parseId: string,
    @Param('fileName') fileName: string,
    @Res() reply: FastifyReply,
  ) {
    return this.importService.getPreviewAsset(parseId, fileName, reply);
  }

  /** 用户上传文件夹内容，按文件名匹配缺失资源 */
  @Post('resolve-assets')
  async resolveAssets(@Req() request: MultipartIterableRequest) {
    let parseId = '';
    const files: { filename: string; buffer: Buffer; mimetype: string }[] = [];

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'parseId') {
          parseId = part.value ?? '';
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

  // ─── 批量导入 ───

  /**
   * 批量解析：接收 zip 文件（保留完整目录结构）+ parentId。
   *
   * 前端用 JSZip 把 webkitdirectory 选中的文件夹打包上传，
   * 后端解压后识别 .md 和资源文件，按相对路径匹配资源引用。
   */
  @Post('batch-parse')
  async batchParse(@Req() request: MultipartIterableRequest) {
    let parentId = '';
    let archiveBuffer: Buffer | null = null;

    for await (const part of request.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'parentId' && part.value) {
          parentId = part.value;
        }
      } else if (part.type === 'file' && part.fieldname === 'archive') {
        archiveBuffer = await part.toBuffer();
      }
    }

    if (!parentId) throw new BadRequestException('parentId 不能为空');
    if (!archiveBuffer) throw new BadRequestException('未收到 zip 文件');

    // 解压 zip，按相对路径建立文件索引
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(archiveBuffer);
    const allFilesByPath = new Map<string, Buffer>(); // relativePath → buffer

    await Promise.all(
      Object.entries(zip.files).map(async ([path, entry]) => {
        if (entry.dir) return;
        const buffer = await entry.async('nodebuffer');
        allFilesByPath.set(path, buffer);
      }),
    );

    // 分离 .md 文件和资源文件
    const mdEntries: Array<{ relativePath: string; buffer: Buffer }> = [];
    for (const [path, buffer] of allFilesByPath) {
      if (path.endsWith('.md')) {
        mdEntries.push({ relativePath: path, buffer });
      }
    }

    if (mdEntries.length === 0)
      throw new BadRequestException('zip 中未找到 .md 文件');

    // 对每个 .md 解析图片引用，从 zip 内按相对路径匹配资源
    const resolveRef = (mdDir: string, ref: string): string => {
      const clean = ref.split('?')[0].split('#')[0];
      const segments = mdDir ? mdDir.split('/') : [];
      for (const p of clean.split('/')) {
        if (p === '.' || p === '') continue;
        if (p === '..') segments.pop();
        else segments.push(p);
      }
      return segments.join('/');
    };

    const imageRefRegex = /!\[[^\]]*\]\(((?!https?:\/\/)[^)]+)\)/g;
    const files = mdEntries.map(({ relativePath, buffer }) => {
      const mdDir = relativePath.split('/').slice(0, -1).join('/');
      const markdown = buffer.toString('utf-8');
      const matchedAssets: Array<{ filename: string; buffer: Buffer }> = [];
      const seen = new Set<string>();

      let match: RegExpExecArray | null;
      while ((match = imageRefRegex.exec(markdown)) !== null) {
        const ref = match[1];
        const resolvedPath = resolveRef(mdDir, ref);
        if (seen.has(resolvedPath)) continue;
        seen.add(resolvedPath);
        const assetBuf = allFilesByPath.get(resolvedPath);
        if (assetBuf) {
          const filename = resolvedPath.split('/').pop() ?? resolvedPath;
          matchedAssets.push({ filename, buffer: assetBuf });
        }
      }
      // 重置 regex lastIndex（g flag 跨字符串不自动重置）
      imageRefRegex.lastIndex = 0;

      return { relativePath, buffer, assets: matchedAssets };
    });

    return this.importService.batchParse(parentId, files);
  }

  /** 批量确认导入 */
  @Post('batch-confirm')
  async batchConfirm(@Body() dto: BatchConfirmDto) {
    return this.importService.batchConfirm(dto);
  }

  /** 获取批量会话信息（预览页刷新恢复） */
  @Get('batch/:batchId')
  async getBatch(@Param('batchId') batchId: string) {
    return this.importService.getBatchSession(batchId);
  }

  /** 取消批量导入，立即清理临时文件 */
  @Delete('batch/:batchId')
  async cancelBatch(@Param('batchId') batchId: string) {
    await this.importService.cancelBatch(batchId);
  }

  /** 取消单文件导入，立即清理临时文件 */
  @Delete('parse/:parseId')
  async cancelParse(@Param('parseId') parseId: string) {
    await this.importService.cancelParse(parseId);
  }

  /** 查询批量导入任务的实时进度 */
  @Get('batch-job/:jobId')
  getBatchJobProgress(@Param('jobId') jobId: string) {
    const progress = this.importService.getBatchJobProgress(jobId);
    if (!progress)
      return {
        total: 0,
        completed: 0,
        status: 'done' as const,
        foldersCreated: 0,
      };
    return progress;
  }
}
