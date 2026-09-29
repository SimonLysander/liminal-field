import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { Readable } from 'node:stream';
import { ExternalMcpService } from '../external-mcp.service';
import { ExternalReadService } from '../external-read.service';
import { ExternalAssetsService } from '../external-assets.service';
import { siteUrl } from '../external-target';

describe('ExternalMcpService with the official MCP client', () => {
  const directory = {
    target: 'library',
    item: null,
    breadcrumbs: [],
    siteUrl: siteUrl(),
    items: [],
    total: 0,
    revision: 'revision',
    nextCursor: null,
  };
  const reader = { browse: jest.fn(), search: jest.fn(), read: jest.fn() };
  const assets = { read: jest.fn() };
  let client: Client;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    reader.browse.mockReset().mockResolvedValue(directory);
    reader.search.mockReset();
    reader.read.mockReset();
    assets.read.mockReset();
    const service = new ExternalMcpService(
      reader as unknown as ExternalReadService,
      assets as unknown as ExternalAssetsService,
    );
    client = new Client({ name: 'external-mcp-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(
      new URL('/api/v1/external/mcp', siteUrl()),
      {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (request.method !== 'POST')
            return new Response(null, { status: 405 });
          return service.handleRequest(request, await request.json());
        },
      },
    );
    await client.connect(transport);
  });
  afterEach(async () => {
    await client.close();
    jest.restoreAllMocks();
  });

  it('negotiates the protocol and discovers exactly four read-only tools with schemas', async () => {
    expect(client.getServerVersion()?.name).toBe('lux-stirring');
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      'browse_library',
      'search_content',
      'read_content',
      'read_asset',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.properties).toBeDefined();
    }
    expect(tools[0].inputSchema.properties).toMatchObject({
      limit: { default: 30, description: expect.any(String) },
    });
    expect(tools[0].outputSchema).toBeDefined();
    expect(tools[3].outputSchema).toBeUndefined();
  });

  it('returns structured results and defaults without the HTTP envelope', async () => {
    const result = CallToolResultSchema.parse(
      await client.callTool({ name: 'browse_library', arguments: {} }),
    );
    expect(result.structuredContent).toEqual(directory);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(directory) },
    ]);
    expect(reader.browse).toHaveBeenCalledWith({ limit: 30 });
  });

  it('rejects unknown parameters before calling the read service', async () => {
    const result = await client.callTool({
      name: 'browse_library',
      arguments: { version: 'private' },
    });
    expect(result.isError).toBe(true);
    expect(reader.browse).not.toHaveBeenCalled();
  });

  it('reports public errors without leaking private existence or internal details', async () => {
    for (const [error, code] of [
      [new NotFoundException('PRIVATE_ITEM_EXISTS'), 'RESOURCE_NOT_FOUND'],
      [new ConflictException('CONTENT_CHANGED'), 'CONTENT_CHANGED'],
      [new Error('DATABASE_PASSWORD'), 'INTERNAL_ERROR'],
    ] as const) {
      reader.browse.mockRejectedValueOnce(error);
      const result = CallToolResultSchema.parse(
        await client.callTool({ name: 'browse_library', arguments: {} }),
      );
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: 'text', text: JSON.stringify({ error: { code } }) },
      ]);
      expect(result.structuredContent).toBeUndefined();
    }
  });

  it('preserves image bytes and UTF-8 text as standard MCP content', async () => {
    const bytes = Buffer.from([82, 73, 70, 70, 0, 255]);
    const image = Readable.from([bytes]);
    assets.read.mockResolvedValueOnce({
      stream: image,
      mediaType: 'image/webp',
      fileName: 'image.png',
    });
    const picture = await client.callTool({
      name: 'read_asset',
      arguments: { assetRef: 'signed-reference', representation: 'preview' },
    });
    expect(picture.content).toEqual([
      { type: 'image', mimeType: 'image/webp', data: bytes.toString('base64') },
    ]);
    expect(image.destroyed).toBe(true);
    const text = '{"formula":"$k \\times x$"}';
    const stream = Readable.from([Buffer.from(text)]);
    assets.read.mockResolvedValueOnce({
      stream,
      mediaType: 'application/json',
      fileName: 'data.json',
    });
    const file = CallToolResultSchema.parse(
      await client.callTool({
        name: 'read_asset',
        arguments: { assetRef: 'signed-reference', representation: 'text' },
      }),
    );
    expect(file.content).toEqual([
      {
        type: 'resource',
        resource: {
          uri: `${siteUrl()}/api/v1/external/assets?assetRef=signed-reference&representation=text`,
          mimeType: 'application/json',
          text,
        },
      },
    ]);
    expect(stream.destroyed).toBe(true);
  });

  it.each([
    ['video/mp4', Buffer.from('video')],
    ['image/webp', Buffer.alloc(4 * 1024 * 1024 + 1)],
    ['text/plain', Buffer.from([255])],
  ])(
    'links %s files that cannot be inlined and closes their streams',
    async (mediaType, bytes) => {
      const stream = Readable.from([bytes]);
      assets.read.mockResolvedValueOnce({
        stream,
        mediaType,
        fileName: 'file',
      });
      const result = await client.callTool({
        name: 'read_asset',
        arguments: { assetRef: 'signed-reference' },
      });
      expect(result.content).toEqual([
        {
          type: 'resource_link',
          uri: `${siteUrl()}/api/v1/external/assets?assetRef=signed-reference`,
          name: 'file',
          mimeType: mediaType,
        },
      ]);
      expect(stream.destroyed).toBe(true);
    },
  );

  it('returns a tool error when an asset stream fails instead of returning a corrupt image', async () => {
    const stream = new Readable({
      read() {
        this.destroy(new Error('Storage disconnected'));
      },
    });
    assets.read.mockResolvedValueOnce({
      stream,
      mediaType: 'image/webp',
      fileName: 'image.png',
    });
    const result = await client.callTool({
      name: 'read_asset',
      arguments: { assetRef: 'signed-reference' },
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: '{"error":{"code":"ASSET_READ_FAILED"}}' },
    ]);
    expect(stream.destroyed).toBe(true);
  });
});
