import supertest from 'supertest';
import { z } from 'zod';
import {
  TestContext,
  login,
  createNoteItem,
  commitNoteContent,
  createAnthologyItem,
  createAnthologyChildNode,
  createGalleryItem,
} from './helpers';
import { ExternalReadModule } from '../src/modules/external-read/external-read.module';
import {
  browseResponseSchema,
  errorResponseSchema,
  readResponseSchema,
  searchResponseSchema,
  successSchema,
} from '../src/modules/external-read/external-read.contract';
import { ExternalReferenceService } from '../src/modules/external-read/external-reference.service';
import { ContentService } from '../src/modules/content/content.service';
import { ContentRepository } from '../src/modules/content/content.repository';
import { ContentSnapshotRepository } from '../src/modules/content/content-snapshot.repository';
import { NavigationRepository } from '../src/modules/navigation/navigation.repository';
import { DigestReportRepository } from '../src/modules/digest/digest-report.repository';
import { OssService } from '../src/modules/oss/oss.service';
import { ContentRepoService } from '../src/modules/content/content-repo.service';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { siteUrl } from '../src/modules/external-read/external-target';
import * as structure from '../src/modules/external-read/document-structure';

describe('External public reading HTTP API', () => {
  const ctx = new TestContext();
  let cookie: string;
  let note: string;
  let hidden: string;
  const publishedBody =
    'Opening explanation.\n\n# Published heading\n\nPublic token public-needle and $k \\times x$.\n\n## Detail\n\n![Visible](./assets/public.png)\n\n[Text](./assets/data.json)\n\n<audio src="./assets/voice.mp3"></audio>\n\n```md\n![Example](./assets/example.png)\n```';

  async function get<T>(
    path: string,
    schema: z.ZodType<T>,
    query: Record<string, string | number> = {},
    asAdmin = false,
  ): Promise<T> {
    const request = supertest(ctx.app.getHttpServer())
      .get(`/api/v1/external/${path}`)
      .query(query);
    if (asAdmin) request.set('Cookie', cookie);
    const response = await request.expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return successSchema(schema).parse(response.body).data;
  }
  async function error(
    path: string,
    status: number,
    query: Record<string, string | number> = {},
  ) {
    const response = await supertest(ctx.app.getHttpServer())
      .get(`/api/v1/external/${path}`)
      .query(query)
      .expect(status);
    return errorResponseSchema.parse(response.body).error.code;
  }
  async function publish(id: string) {
    await ctx.app.get(ContentService).publishVersion(id);
  }

  beforeAll(async () => {
    await ctx.setup([ExternalReadModule]);
    cookie = await login(ctx.app);
    note = await createNoteItem(ctx.app, cookie, 'Published title');
    await commitNoteContent(
      ctx.app,
      cookie,
      note,
      publishedBody,
      'Published title',
    );
    await publish(note);
    await commitNoteContent(
      ctx.app,
      cookie,
      note,
      '# PRIVATE_TITLE\n\nSECRET_DRAFT_NEEDLE',
      'PRIVATE_TITLE',
    );
    hidden = await createNoteItem(ctx.app, cookie, 'PRIVATE_ONLY');
    await commitNoteContent(
      ctx.app,
      cookie,
      hidden,
      '# SECRET_UNPUBLISHED_BODY',
      'PRIVATE_ONLY',
    );
    jest
      .spyOn(ctx.app.get(OssService), 'isDraftStorageReady')
      .mockReturnValue(true);
    ctx.ossStore.set(
      `assets/${note}/public.png`,
      Buffer.from([137, 80, 78, 71, 0, 255, 10]),
    );
    ctx.ossStore.set(`assets/${note}/data.json`, Buffer.from('{"value":42}'));
    ctx.ossStore.set(
      `assets/${note}/voice.mp3`,
      Buffer.from([73, 68, 51, 0, 255]),
    );
    ctx.ossStore.set(
      `assets/${note}/private.png`,
      Buffer.from('PRIVATE_ATTACHMENT'),
    );
    await ctx.app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await ctx.teardown();
  });

  it('serves all four tools over real Streamable HTTP using the official SDK client, without elevating admin access', async () => {
    const endpoint = new URL('/api/v1/external/mcp', await ctx.app.getUrl());
    const client = new Client({ name: 'public-reader-e2e', version: '1.0.0' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(endpoint, {
          requestInit: { headers: { Cookie: cookie } },
        }),
      );
      expect((await client.listTools()).tools).toHaveLength(4);
      const directory = CallToolResultSchema.parse(
        await client.callTool({ name: 'browse_library', arguments: {} }),
      );
      expect(
        browseResponseSchema
          .parse(directory.structuredContent)
          .items.map((item) => item.target),
      ).toEqual(['notes', 'anthology', 'gallery', 'digest']);
      const search = CallToolResultSchema.parse(
        await client.callTool({
          name: 'search_content',
          arguments: { query: 'public-needle' },
        }),
      );
      expect(
        searchResponseSchema
          .parse(search.structuredContent)
          .items.map((item) => item.target),
      ).toEqual([`notes:${note}`]);
      const read = CallToolResultSchema.parse(
        await client.callTool({
          name: 'read_content',
          arguments: { target: `notes:${note}` },
        }),
      );
      const content = readResponseSchema.parse(read.structuredContent);
      expect(content.bodyMarkdown).toBe(publishedBody);
      expect(JSON.stringify(content)).not.toContain('PRIVATE');
      const asset = content.assets.find(
        (file) => file.fileName === 'public.png',
      )!;
      const image = await client.callTool({
        name: 'read_asset',
        arguments: { assetRef: asset.assetRef },
      });
      expect(image.content).toEqual([
        {
          type: 'image',
          mimeType: 'image/webp',
          data: ctx.ossStore
            .get(`assets/${note}/public.png`)!
            .toString('base64'),
        },
      ]);
      const original = await client.callTool({
        name: 'read_asset',
        arguments: { assetRef: asset.assetRef, representation: 'original' },
      });
      expect(original.isError).toBe(true);
      expect(original.content).toEqual([
        {
          type: 'text',
          text: '{"error":{"code":"REPRESENTATION_UNAVAILABLE"}}',
        },
      ]);
      const forbidden = await client.callTool({
        name: 'read_content',
        arguments: { target: `notes:${hidden}` },
      });
      expect(forbidden.isError).toBe(true);
      expect(forbidden.content).toEqual([
        { type: 'text', text: '{"error":{"code":"RESOURCE_NOT_FOUND"}}' },
      ]);
    } finally {
      await client.close();
    }
  });

  it('validates MCP origins and envelopes, and exposes no standalone stream or session', async () => {
    const route = '/api/v1/external/mcp';
    for (const method of ['GET', 'DELETE', 'PUT'] as const) {
      const response = await ctx.app.inject({ method, url: route });
      expect(response.statusCode).toBe(405);
      expect(response.headers.allow).toBe('POST');
    }
    const headers = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    const message = { jsonrpc: '2.0', id: 7, method: 'tools/list' };
    const rejected = await ctx.app.inject({
      method: 'POST',
      url: route,
      headers: { ...headers, origin: 'https://attacker.example' },
      payload: message,
    });
    expect(rejected.statusCode).toBe(403);
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: route,
      headers,
      payload: { not: 'JSON-RPC' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(
      z
        .object({
          jsonrpc: z.literal('2.0'),
          error: z.object({ code: z.number() }),
        })
        .parse(JSON.parse(invalid.body)).jsonrpc,
    ).toBe('2.0');
    const responses = await Promise.all(
      [1, 2].map(() =>
        ctx.app.inject({
          method: 'POST',
          url: route,
          headers: { ...headers, origin: siteUrl() },
          payload: message,
        }),
      ),
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers['mcp-session-id']).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');
      expect(
        z
          .object({
            id: z.literal(7),
            result: z.object({ tools: z.array(z.unknown()).length(4) }),
          })
          .parse(JSON.parse(response.body)).id,
      ).toBe(7);
    }
  });

  it('discovers all four public areas and paginates without duplicates', async () => {
    const first = await get('browse', browseResponseSchema, { limit: 2 });
    expect(first.items.map((item) => item.target)).toEqual([
      'notes',
      'anthology',
    ]);
    const second = await get('browse', browseResponseSchema, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((item) => item.target)).toEqual([
      'gallery',
      'digest',
    ]);
    expect(second.nextCursor).toBeNull();
    expect(
      await error('browse', 400, {
        target: 'notes',
        cursor: first.nextCursor!,
      }),
    ).toBe('INVALID_CURSOR');
  });
  it('reads only the published body, title and referenced assets with or without admin login', async () => {
    for (const asAdmin of [false, true]) {
      const result = await get(
        'content',
        readResponseSchema,
        { target: `/note?node=${note}` },
        asAdmin,
      );
      expect(result.bodyMarkdown).toBe(publishedBody);
      expect(result.item.title).toBe('Published title');
      expect(result.assets.map((asset) => asset.fileName)).toEqual([
        'public.png',
        'data.json',
        'voice.mp3',
      ]);
      expect(JSON.stringify(result)).not.toContain('PRIVATE');
      expect(result.sections.map((section) => section.level)).toEqual([
        0, 1, 2,
      ]);
    }
    expect(await error('content', 404, { target: `notes:${hidden}` })).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });
  it('reads a section and preamble using references, not heading-name guesses', async () => {
    const result = await get('content', readResponseSchema, {
      target: `notes:${note}`,
    });
    const section = await get('content', readResponseSchema, {
      target: `notes:${note}`,
      sectionRef: result.sections[2].sectionRef,
    });
    expect(section.bodyMarkdown).toMatch(/^## Detail/);
    expect(section.bodyMarkdown).not.toContain('Opening');
    const preamble = await get('content', readResponseSchema, {
      target: `notes:${note}`,
      sectionRef: result.sections[0].sectionRef,
    });
    expect(preamble.bodyMarkdown).toBe('Opening explanation.\n\n');
    expect(
      await error('content', 400, {
        target: `notes:${note}`,
        cursor: result.sections[0].sectionRef,
      }),
    ).toBe('INVALID_CURSOR');
  });
  it('searches published bodies and title without treating regex syntax as instructions', async () => {
    const result = await get('search', searchResponseSchema, {
      query: 'public-needle',
      within: 'notes',
    });
    expect(result.items.map((item) => item.target)).toEqual([`notes:${note}`]);
    expect(result.items[0].snippet).toContain('public-needle');
    for (const query of ['SECRET_DRAFT_NEEDLE', 'PRIVATE_ONLY', '.*']) {
      expect(
        (await get('search', searchResponseSchema, { query }, true)).items,
      ).toEqual([]);
    }
  });
  it('returns image previews and other attachments without JSON wrapping or corruption', async () => {
    const result = await get('content', readResponseSchema, {
      target: `notes:${note}`,
    });
    const picture = result.assets.find((asset) => asset.type === 'image')!;
    const response = await ctx.app.inject({
      method: 'GET',
      url: picture.url!,
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(
      ctx.ossStore.get(`assets/${note}/public.png`),
    );
    expect(response.headers['content-type']).toMatch(/^image\/webp/);
    expect(picture.representations).toEqual(['preview']);
    expect(
      await error('assets', 415, {
        assetRef: picture.assetRef,
        representation: 'original',
      }),
    ).toBe('REPRESENTATION_UNAVAILABLE');
    expect(
      await error('assets', 415, {
        assetRef: picture.assetRef,
        representation: 'text',
      }),
    ).toBe('REPRESENTATION_UNAVAILABLE');
    const text = result.assets.find((asset) => asset.fileName === 'data.json')!;
    const jsonFile = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/external/assets?assetRef=${text.assetRef}&representation=text`,
    });
    expect(jsonFile.body).toBe('{"value":42}');
    const audio = result.assets.find((asset) => asset.type === 'audio')!;
    expect(
      (await ctx.app.inject({ method: 'GET', url: audio.url! })).rawPayload,
    ).toEqual(ctx.ossStore.get(`assets/${note}/voice.mp3`));
  });
  it('does not grant access to unreferenced files, tampered references or protected routes', async () => {
    const result = await get('content', readResponseSchema, {
      target: `notes:${note}`,
    });
    const references = ctx.app.get(ExternalReferenceService);
    const privateFile = references.encode({
      kind: 'asset',
      target: result.item.target,
      revision: result.item.revision!,
      fileName: 'private.png',
    });
    expect(await error('assets', 404, { assetRef: privateFile })).toBe(
      'RESOURCE_NOT_FOUND',
    );
    expect(
      await error('assets', 400, { assetRef: `${result.assets[0].assetRef}x` }),
    ).toBe('INVALID_REFERENCE');
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/spaces/notes/items')
      .set('Cookie', `auth_token=${result.assets[0].assetRef}`)
      .send({ title: 'Unauthorized' })
      .expect(401);
  });

  it('streams the published Git blob rather than a subsequently modified worktree file', async () => {
    const id = await createNoteItem(ctx.app, cookie, 'Archived asset');
    const repo = ctx.app.get(ContentRepoService);
    const original = Buffer.from([0, 255, 137, 80, 78, 71]);
    const asset = await repo.storeAsset(id, 'original.bin', original);
    await commitNoteContent(
      ctx.app,
      cookie,
      id,
      `![Archive](${asset.path})`,
      'Archived asset',
    );
    await publish(id);
    const head = await ctx.app.get(ContentRepository).findById(id);
    let snapshot = await ctx.app
      .get(ContentSnapshotRepository)
      .findByVersionId(head!.publishedVersion!.versionId!);
    for (let attempt = 0; !snapshot?.commitHash && attempt < 200; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      snapshot = await ctx.app
        .get(ContentSnapshotRepository)
        .findByVersionId(head!.publishedVersion!.versionId!);
    }
    expect(snapshot?.commitHash).toBeTruthy();
    await writeFile(
      join(repo.repoRoot, 'content', id, 'assets', asset.fileName),
      Buffer.from('PRIVATE_NEW_FILE'),
    );
    const oss = ctx.app.get(OssService);
    jest.spyOn(oss, 'isDraftStorageReady').mockReturnValue(false);
    try {
      const result = await get('content', readResponseSchema, {
        target: `notes:${id}`,
      });
      expect(result.assets[0].representations).toEqual(['original']);
      const response = await ctx.app.inject({
        method: 'GET',
        url: result.assets[0].url!,
      });
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(original);
      jest.spyOn(oss, 'isDraftStorageReady').mockReturnValue(true);
      // Older assets can exist in Git without a permanent OSS object.
      const fallback = await ctx.app.inject({
        method: 'GET',
        url: result.assets[0].url!,
      });
      expect(fallback.statusCode).toBe(200);
      expect(fallback.rawPayload).toEqual(original);

      const automatic = await get('content', readResponseSchema, {
        target: `notes:${id}`,
      });
      const preferred = await ctx.app.inject({
        method: 'GET',
        url: automatic.assets[0].url!,
      });
      expect(preferred.statusCode).toBe(200);
      expect(preferred.headers['content-type']).toMatch(
        /^application\/octet-stream/,
      );
      expect(preferred.rawPayload).toEqual(original);
      expect(
        await error('assets', 415, {
          assetRef: automatic.assets[0].assetRef,
          representation: 'preview',
        }),
      ).toBe('REPRESENTATION_UNAVAILABLE');
    } finally {
      jest.spyOn(oss, 'isDraftStorageReady').mockReturnValue(true);
    }
  });

  it('keeps public body reading available but never serves an original image without a preview', async () => {
    const oss = ctx.app.get(OssService);
    const unavailable = jest
      .spyOn(oss, 'getObjectStream')
      .mockRejectedValue(
        Object.assign(new Error('Missing'), { code: 'NoSuchKey' }),
      );
    try {
      const body = await get('content', readResponseSchema, {
        target: `notes:${note}`,
      });
      expect(body.bodyMarkdown).toBe(publishedBody);
      expect(
        await error('assets', 415, { assetRef: body.assets[0].assetRef }),
      ).toBe('REPRESENTATION_UNAVAILABLE');
      expect(
        await error('assets', 415, {
          assetRef: body.assets[0].assetRef,
          representation: 'original',
        }),
      ).toBe('REPRESENTATION_UNAVAILABLE');
      jest.spyOn(oss, 'isDraftStorageReady').mockReturnValue(false);
      const withoutPreviews = await get('content', readResponseSchema, {
        target: `notes:${note}`,
      });
      expect(withoutPreviews.bodyMarkdown).toBe(publishedBody);
      expect(withoutPreviews.assets[0]).toMatchObject({
        representations: [],
        url: null,
      });
      expect(
        await error('assets', 415, {
          assetRef: withoutPreviews.assets[0].assetRef,
        }),
      ).toBe('REPRESENTATION_UNAVAILABLE');
    } finally {
      unavailable.mockRestore();
      jest.spyOn(oss, 'isDraftStorageReady').mockReturnValue(true);
    }
  });

  it('keeps core HTTP and MCP reading available when attachment storage fails', async () => {
    const document = await get('content', readResponseSchema, {
      target: `notes:${note}`,
    });
    const unavailable = jest
      .spyOn(ctx.app.get(OssService), 'getObjectStream')
      .mockRejectedValue(
        Object.assign(new Error('Storage network disconnected'), {
          code: 'ECONNRESET',
        }),
      );
    const client = new Client({
      name: 'asset-failure-isolation',
      version: '1.0.0',
    });
    try {
      expect(
        await error('assets', 503, { assetRef: document.assets[0].assetRef }),
      ).toBe('ASSET_READ_FAILED');
      await get('browse', browseResponseSchema);
      const body = await get('content', readResponseSchema, {
        target: `notes:${note}`,
      });
      expect(body.bodyMarkdown).toBe(publishedBody);
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL('/api/v1/external/mcp', await ctx.app.getUrl()),
        ),
      );
      const failed = await client.callTool({
        name: 'read_asset',
        arguments: { assetRef: document.assets[0].assetRef },
      });
      expect(failed.isError).toBe(true);
      const readable = CallToolResultSchema.parse(
        await client.callTool({
          name: 'read_content',
          arguments: { target: `notes:${note}` },
        }),
      );
      expect(
        readResponseSchema.parse(readable.structuredContent).bodyMarkdown,
      ).toBe(publishedBody);
      expect((await client.listTools()).tools).toHaveLength(4);
    } finally {
      unavailable.mockRestore();
      await client.close();
    }
  });

  it('parses once per request and paginates a nested section losslessly without adjacent sections', async () => {
    const id = await createNoteItem(ctx.app, cookie, 'Section pagination');
    const body =
      'Overview\n\n# Parent\n\nBefore child.\n\n## Selected\n\n' +
      Array.from(
        { length: 12 },
        (_, index) => `Paragraph ${index}: ${'文😀'.repeat(80)}\n\n`,
      ).join('') +
      '## Sibling\n\nSibling only.\n\n# Next\n\nNext chapter.';
    await commitNoteContent(ctx.app, cookie, id, body, 'Section pagination');
    await publish(id);
    const parse = jest.spyOn(structure, 'documentStructure');
    try {
      const whole = await get('content', readResponseSchema, {
        target: `notes:${id}`,
      });
      expect(parse).toHaveBeenCalledTimes(1);
      const section = whole.sections.find(
        (candidate) => candidate.title === 'Selected',
      )!;
      const query = {
        target: `notes:${id}`,
        sectionRef: section.sectionRef,
        maxCharacters: 1000,
      };
      parse.mockClear();
      let page = await get('content', readResponseSchema, query);
      expect(parse).toHaveBeenCalledTimes(1);
      let joined = page.bodyMarkdown!;
      let iterations = 0;
      while (page.nextCursor) {
        expect(++iterations).toBeLessThan(20);
        parse.mockClear();
        page = await get('content', readResponseSchema, {
          ...query,
          cursor: page.nextCursor,
        });
        expect(parse).toHaveBeenCalledTimes(1);
        joined += page.bodyMarkdown!;
      }
      expect(joined).toBe(body.slice(section.start, section.end));
      expect(joined).not.toContain('Sibling only');
      expect(joined).not.toContain('Next chapter');
      expect(page.totalCharacters).toBe(joined.length);
    } finally {
      parse.mockRestore();
    }
  });

  it('rejects mismatched snapshot ownership in both reading and body search', async () => {
    const id = await createNoteItem(ctx.app, cookie, 'Corrupt public pointer');
    const repo = ctx.app.get(ContentRepository);
    const snapshots = ctx.app.get(ContentSnapshotRepository);
    const head = await repo.findById(id);
    const privateVersion = 'private_wrong_owner';
    await snapshots.create({
      versionId: privateVersion,
      contentItemId: hidden,
      title: 'Private title',
      summary: '',
      bodyMarkdown: 'ownership-private-needle',
      assetRefs: [],
      createdAt: new Date(),
      changeNote: 'Private version',
    });
    await repo.update(id, {
      latestVersion: head!.latestVersion!,
      publishedVersion: {
        title: 'Corrupt public pointer',
        versionId: privateVersion,
        commitHash: '',
      },
      changeLogs: head!.changeLogs,
      updatedAt: new Date(),
    });
    expect(await error('content', 404, { target: `notes:${id}` })).toBe(
      'RESOURCE_NOT_FOUND',
    );
    expect(
      (
        await get('search', searchResponseSchema, {
          query: 'ownership-private-needle',
        })
      ).items,
    ).toEqual([]);
  });
  it('keeps readable note descendants visible without exposing the unpublished ancestor body or sibling', async () => {
    const navigation = ctx.app.get(NavigationRepository);
    const parent = await navigation.findByContentItemId(hidden);
    const child = await createNoteItem(ctx.app, cookie, 'Public descendant');
    const childNode = await navigation.findByContentItemId(child);
    await navigation.update(childNode!._id.toString(), {
      parentId: parent!._id.toString(),
    });
    await commitNoteContent(
      ctx.app,
      cookie,
      child,
      '# Visible descendant',
      'Public descendant',
    );
    await publish(child);
    const sibling = await createNoteItem(ctx.app, cookie, 'Private sibling');
    const siblingNode = await navigation.findByContentItemId(sibling);
    await navigation.update(siblingNode!._id.toString(), {
      parentId: parent!._id.toString(),
    });
    const directory = await get('browse', browseResponseSchema, {
      target: `notes:${hidden}`,
    });
    expect(directory.items.map((item) => item.target)).toEqual([
      `notes:${child}`,
    ]);
    expect(directory.item).toMatchObject({
      bodyAvailable: false,
      childrenAvailable: true,
    });
    expect(
      (await get('content', readResponseSchema, { target: `notes:${hidden}` }))
        .bodyMarkdown,
    ).toBeNull();
    expect(await error('content', 404, { target: `notes:${sibling}` })).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });
  it('requires a published anthology parent and child and validates the URL parent', async () => {
    const parent = await createAnthologyItem(ctx.app, cookie, 'Collection');
    const child = await createAnthologyChildNode(
      ctx.app,
      cookie,
      parent,
      'Published entry',
      '---\ndate: 2026-09-01\n---\n# Entry\n\nPublished prose',
    );
    await publish(child);
    expect(await error('content', 404, { target: `anthology:${child}` })).toBe(
      'RESOURCE_NOT_FOUND',
    );
    await publish(parent);
    const entry = await get('content', readResponseSchema, {
      target: `/anthology?at=${parent}&node=${child}`,
    });
    expect(entry.item.title).toBe('Published entry');
    expect(entry.bodyMarkdown).toContain('Published prose');
    expect(
      await error('content', 404, {
        target: `/anthology?at=${note}&node=${child}`,
      }),
    ).toBe('RESOURCE_NOT_FOUND');
    await ctx.app.get(ContentService).unpublishVersion(parent);
    expect(await error('content', 404, { target: `anthology:${child}` })).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });
  it('uses published gallery frontmatter to order and describe media without listing other stored files', async () => {
    const id = await createGalleryItem(ctx.app, cookie, 'Photo collection');
    const repo = ctx.app.get(ContentRepository);
    const snapshots = ctx.app.get(ContentSnapshotRepository);
    const item = await repo.findById(id);
    const versionId = 'gallery_external_published';
    const body =
      '---\nphotos:\n  - file: second.png\n    caption: Second photo\n    tags:\n      camera: Example\n  - file: first.png\n    caption: First photo\n---\nPublic gallery prose';
    await snapshots.create({
      versionId,
      contentItemId: id,
      title: 'Photo collection',
      summary: '',
      bodyMarkdown: body,
      assetRefs: [],
      createdAt: new Date(),
      changeNote: 'Gallery publication',
    });
    await repo.update(id, {
      latestVersion: { ...item!.latestVersion!, versionId },
      publishedVersion: { ...item!.latestVersion!, versionId },
      changeLogs: item!.changeLogs,
      updatedAt: new Date(),
    });
    ctx.ossStore.set(`assets/${id}/unlisted.png`, Buffer.from('not public'));
    const gallery = await get('content', readResponseSchema, {
      target: `/gallery?post=${id}`,
    });
    expect(gallery.assets.map((asset) => asset.fileName)).toEqual([
      'second.png',
      'first.png',
    ]);
    expect(gallery.assets[0]).toMatchObject({
      description: 'Second photo',
      metadata: { camera: 'Example' },
    });
    expect(gallery.bodyMarkdown).not.toContain('unlisted');
  });
  it('reads only publicly listed digest topics and each period latest report, preserving public citations', async () => {
    const topic = await ctx.app
      .get(ContentService)
      .createContent({ title: 'Public digest topic' });
    await ctx.app.get(NavigationRepository).create({
      name: 'Public digest topic',
      scope: 'digest',
      contentItemId: topic.id,
    });
    const reports = ctx.app.get(DigestReportRepository);
    for (const [id, date, markdown] of [
      ['report_old', '2026-09-01', 'Old publication'],
      [
        'report_new',
        '2026-09-02',
        '# Current report\n\npublic-report-needle [@#CIT 1]',
      ],
    ]) {
      await reports.create({
        _id: id,
        topicId: topic.id,
        periodKey: '2026-09-01',
        taskId: 'private-task',
        headline: id,
        deck: 'Public overview',
        markdown,
        findings: [
          {
            citationId: 1,
            sourceId: 'internal_source',
            itemGuid: 'internal_item',
            title: 'Source title',
            url: 'https://example.com/source',
            sourceName: 'Example',
            reason: 'INTERNAL_REASON',
            snippet: 'INTERNAL_SNIPPET',
          },
        ],
        publishedAt: new Date(date),
      });
    }
    const directory = await get('browse', browseResponseSchema, {
      target: `digest:${topic.id}`,
    });
    expect(directory.items.map((item) => item.target)).toEqual([
      `report:${topic.id}:report_new`,
    ]);
    const report = await get('content', readResponseSchema, {
      target: directory.items[0].target,
    });
    expect(report.citations).toEqual([
      {
        id: 1,
        title: 'Source title',
        url: 'https://example.com/source',
        source: 'Example',
      },
    ]);
    expect(JSON.stringify(report)).not.toContain('INTERNAL_');
    expect(
      (
        await get('search', searchResponseSchema, {
          query: 'public-report-needle',
        })
      ).items,
    ).toHaveLength(1);
    expect(
      await error('content', 404, { target: `report:${note}:report_new` }),
    ).toBe('RESOURCE_NOT_FOUND');
  });
  it('paginates a large Markdown body losslessly and invalidates section, page and asset references on publication changes', async () => {
    const id = await createNoteItem(ctx.app, cookie, 'Long content');
    const body =
      '# Long content\n\n' +
      Array.from(
        { length: 40 },
        (_, index) => `Paragraph ${index}: ${'文😀'.repeat(70)}.\n\n`,
      ).join('') +
      '![Picture](./assets/public.png)';
    await commitNoteContent(ctx.app, cookie, id, body, 'Long content');
    await publish(id);
    let current = await get('content', readResponseSchema, {
      target: `notes:${id}`,
      maxCharacters: 1000,
    });
    const first = current;
    let joined = current.bodyMarkdown!;
    let iterations = 0;
    while (current.nextCursor) {
      expect(++iterations).toBeLessThan(40);
      current = await get('content', readResponseSchema, {
        target: `notes:${id}`,
        cursor: current.nextCursor,
        maxCharacters: 1000,
      });
      joined += current.bodyMarkdown!;
    }
    expect(joined).toBe(body);
    await commitNoteContent(
      ctx.app,
      cookie,
      id,
      '# Revised publication',
      'Revised publication',
    );
    // An unpublished commit does not invalidate public references.
    await get('content', readResponseSchema, {
      target: `notes:${id}`,
      cursor: first.nextCursor!,
      maxCharacters: 1000,
    });
    await publish(id);
    expect(
      await error('content', 409, {
        target: `notes:${id}`,
        cursor: first.nextCursor!,
      }),
    ).toBe('CONTENT_CHANGED');
    expect(
      await error('content', 409, {
        target: `notes:${id}`,
        sectionRef: first.sections[0].sectionRef,
      }),
    ).toBe('CONTENT_CHANGED');
    expect(
      await error('assets', 409, { assetRef: first.assets[0].assetRef }),
    ).toBe('CONTENT_CHANGED');
    await ctx.app.get(ContentService).unpublishVersion(id);
    expect(
      await error('assets', 404, { assetRef: first.assets[0].assetRef }),
    ).toBe('RESOURCE_NOT_FOUND');
  });
  it('rejects private/history query selectors and exposes a raw, read-only OpenAPI document', async () => {
    const invalidQueries: Array<Record<string, string>> = [
      { visibility: 'all' },
      { versionId: 'private' },
      { limit: '0' },
    ];
    for (const query of invalidQueries)
      expect(await error('browse', 400, query)).toBe('INVALID_ARGUMENT');
    const response = await supertest(ctx.app.getHttpServer())
      .get('/api/v1/external/openapi.json')
      .expect(200);
    expect(response.body).toMatchObject({
      openapi: '3.1.0',
      'x-agent-instructions': expect.stringContaining(
        `${siteUrl()}/api/v1/external/openapi.json`,
      ),
      paths: { '/external/content': { get: { operationId: 'read_content' } } },
    });
    expect(response.body).not.toHaveProperty('data');
    await supertest(ctx.app.getHttpServer())
      .post('/api/v1/external/content')
      .set('Cookie', cookie)
      .send({ target: note })
      .expect(404);
  });
});
