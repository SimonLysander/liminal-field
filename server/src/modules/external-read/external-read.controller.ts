import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { RawResponse } from '../../common/raw-response.decorator';
import { ExternalReadService } from './external-read.service';
import { ExternalAssetsService } from './external-assets.service';
import { ExternalReadFilter } from './external-read.filter';
import {
  assetQuerySchema,
  browseQuerySchema,
  parseQuery,
  readQuerySchema,
  searchQuerySchema,
} from './external-read.contract';
import { externalOpenApi } from './external-openapi';

@Public()
@UseFilters(ExternalReadFilter)
@Controller('external')
export class ExternalReadController {
  constructor(
    private readonly reader: ExternalReadService,
    private readonly assets: ExternalAssetsService,
  ) {}

  @Get('browse')
  @Header('Cache-Control', 'no-store')
  browse(@Query() query: unknown) {
    return this.reader.browse(parseQuery(browseQuerySchema, query));
  }

  @Get('search')
  @Header('Cache-Control', 'no-store')
  search(@Query() query: unknown) {
    return this.reader.search(parseQuery(searchQuerySchema, query));
  }

  @Get('content')
  @Header('Cache-Control', 'no-store')
  read(@Query() query: unknown) {
    return this.reader.read(parseQuery(readQuerySchema, query));
  }

  @Get('openapi.json')
  @RawResponse()
  @Header('Cache-Control', 'no-store')
  openapi() {
    return externalOpenApi();
  }

  @Get('assets')
  @RawResponse()
  async asset(@Query() query: unknown, @Res() reply: FastifyReply) {
    const { assetRef, representation } = parseQuery(assetQuerySchema, query);
    const { stream, mediaType, fileName } = await this.assets.read(
      assetRef,
      representation,
    );
    const safeInline =
      mediaType.startsWith('image/') && mediaType !== 'image/svg+xml';
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header(
        'Content-Disposition',
        `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName).replace(/'/g, '%27')}`,
      )
      .type(mediaType);
    return reply.send(stream);
  }
}
