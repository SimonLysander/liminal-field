import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { Body, Controller, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { RawResponse } from '../../common/raw-response.decorator';
import { InlineAssistDto } from './dto/inline-assist.dto';
import { InlineAssistService } from './inline-assist.service';

@Controller('inline-assist')
export class InlineAssistController {
  constructor(private readonly inlineAssistService: InlineAssistService) {}

  @Post()
  assist(@Body() dto: InlineAssistDto) {
    return this.inlineAssistService.assist(dto);
  }

  @RawResponse()
  @Post('stream')
  async assistStream(@Body() dto: InlineAssistDto, @Res() reply: FastifyReply) {
    const response = await this.inlineAssistService.assistStream(dto);

    response.headers.forEach((value, name) => {
      reply.header(name, value);
    });
    reply.code(response.status);

    // AI SDK returns a Web Response. Fastify accepts Node streams, not the
    // Response object itself; forwarding it directly causes an immediate 500.
    return reply.send(
      response.body
        ? Readable.fromWeb(
            response.body as unknown as NodeReadableStream<Uint8Array>,
          )
        : undefined,
    );
  }
}
