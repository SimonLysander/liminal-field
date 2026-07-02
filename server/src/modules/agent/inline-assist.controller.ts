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
    return reply.send(response);
  }
}
