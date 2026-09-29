import { All, Controller, Logger, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { RawResponse } from '../../common/raw-response.decorator';
import { ExternalMcpService } from './external-mcp.service';
import { siteUrl } from './external-target';

@Public()
@Controller('external')
export class ExternalMcpController {
  private readonly logger = new Logger(ExternalMcpController.name);
  constructor(private readonly mcp: ExternalMcpService) {}

  @All('mcp')
  @RawResponse()
  async handle(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');
    // No standalone SSE stream or persistent session is exposed by this read-only API.
    if (request.method !== 'POST')
      return reply.header('Allow', 'POST').status(405).send();
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== new URL(siteUrl()).origin) {
      this.logger.warn({ event: 'mcp_origin_rejected' });
      return reply.status(403).send({ error: 'Forbidden origin' });
    }
    const startedAt = Date.now();
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value])
            headers.append(key, item);
        }
      }
      // Fastify has parsed JSON already; the SDK still validates the JSON-RPC envelope.
      const response = await this.mcp.handleRequest(
        new Request(new URL('/api/v1/external/mcp', siteUrl()), {
          method: 'POST',
          headers,
        }),
        request.body,
      );
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      this.logger.debug({
        event: 'mcp_request_completed',
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return reply
        .status(response.status)
        .send(response.body ? await response.text() : undefined);
    } catch (error) {
      this.logger.error(
        { event: 'mcp_request_failed', durationMs: Date.now() - startedAt },
        error instanceof Error ? error.stack : undefined,
      );
      return reply.status(500).send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'Internal server error' },
      });
    }
  }
}
