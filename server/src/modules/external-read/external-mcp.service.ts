import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ExternalReadService } from './external-read.service';
import { ExternalAssetsService } from './external-assets.service';
import { externalReadError } from './external-read.filter';
import { siteUrl } from './external-target';
import {
  assetQuerySchema,
  browseQuerySchema,
  browseResponseSchema,
  readQuerySchema,
  readResponseSchema,
  searchQuerySchema,
  searchResponseSchema,
} from './external-read.contract';
import {
  externalMcpAssetDescription,
  externalToolDescriptions,
} from '../../prompts/external-tools';

const inlineByteLimit = 4 * 1024 * 1024;
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

function structured(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

@Injectable()
export class ExternalMcpService {
  private readonly logger = new Logger(ExternalMcpService.name);

  constructor(
    private readonly reader: ExternalReadService,
    private readonly assets: ExternalAssetsService,
  ) {}

  async handleRequest(
    request: Request,
    parsedBody: unknown,
  ): Promise<Response> {
    // A fresh server/transport per request isolates clients and repeated JSON-RPC ids.
    const server = this.createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(request, { parsedBody });
    } finally {
      // JSON response bodies are already complete; no SSE session outlives the request.
      await server.close();
    }
  }

  private createServer(): McpServer {
    const server = new McpServer({ name: 'lux-stirring', version: '1.0.0' });
    server.registerTool(
      'browse_library',
      {
        description: externalToolDescriptions.browse_library,
        inputSchema: browseQuerySchema,
        outputSchema: browseResponseSchema,
        annotations,
      },
      (args) =>
        this.execute('browse_library', async () =>
          structured(await this.reader.browse(args)),
        ),
    );
    server.registerTool(
      'search_content',
      {
        description: externalToolDescriptions.search_content,
        inputSchema: searchQuerySchema,
        outputSchema: searchResponseSchema,
        annotations,
      },
      (args) =>
        this.execute('search_content', async () =>
          structured(await this.reader.search(args)),
        ),
    );
    server.registerTool(
      'read_content',
      {
        description: externalToolDescriptions.read_content,
        inputSchema: readQuerySchema,
        outputSchema: readResponseSchema,
        annotations,
      },
      (args) =>
        this.execute('read_content', async () =>
          structured(await this.reader.read(args)),
        ),
    );
    server.registerTool(
      'read_asset',
      {
        description: externalMcpAssetDescription,
        inputSchema: assetQuerySchema,
        annotations,
      },
      (args) => this.execute('read_asset', () => this.readAsset(args)),
    );
    return server;
  }

  private async execute(
    name: string,
    action: () => Promise<CallToolResult>,
  ): Promise<CallToolResult> {
    const startedAt = Date.now();
    this.logger.debug({ event: 'mcp_tool_started', tool: name });
    try {
      const result = await action();
      this.logger.debug({
        event: 'mcp_tool_completed',
        tool: name,
        durationMs: Date.now() - startedAt,
      });
      return result;
    } catch (error) {
      const { status, code } = externalReadError(error);
      const context = {
        event: 'mcp_tool_failed',
        tool: name,
        status,
        code,
        durationMs: Date.now() - startedAt,
      };
      if (status >= 500)
        this.logger.error(
          context,
          error instanceof Error ? error.stack : undefined,
        );
      else this.logger.debug(context);
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: { code } }) }],
      };
    }
  }

  private async readAsset(args: {
    assetRef: string;
    representation?: 'original' | 'preview' | 'text';
  }): Promise<CallToolResult> {
    const { stream, mediaType, fileName } = await this.assets.read(
      args.assetRef,
      args.representation,
    );
    const url = new URL('/api/v1/external/assets', siteUrl());
    url.searchParams.set('assetRef', args.assetRef);
    if (args.representation)
      url.searchParams.set('representation', args.representation);
    const linked: CallToolResult = {
      content: [
        {
          type: 'resource_link',
          uri: url.href,
          name: fileName,
          mimeType: mediaType,
        },
      ],
    };
    const isImage = mediaType === 'image/webp';
    const isText =
      mediaType.startsWith('text/') ||
      ['application/json', 'application/xml'].includes(mediaType);
    try {
      if (!isImage && !isText) return linked;
      // Larger inline payloads use the same authorized HTTP representation, never image originals.
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream.iterator({
        destroyOnReturn: false,
      }) as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > inlineByteLimit) return linked;
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, size);
      if (isImage)
        return {
          content: [
            {
              type: 'image',
              data: bytes.toString('base64'),
              mimeType: mediaType,
            },
          ],
        };
      let text: string;
      try {
        text = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        this.logger.debug({ event: 'mcp_asset_non_utf8', fileName });
        return linked;
      }
      return {
        content: [
          {
            type: 'resource',
            resource: { uri: url.href, mimeType: mediaType, text },
          },
        ],
      };
    } catch (error) {
      this.logger.error(
        { event: 'mcp_asset_stream_failed', fileName },
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException('ASSET_READ_FAILED');
    } finally {
      stream.destroy();
    }
  }
}
