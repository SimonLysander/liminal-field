import { BadRequestException } from '@nestjs/common';
import {
  browseQuerySchema,
  parseQuery,
  readQuerySchema,
  searchQuerySchema,
} from '../external-read.contract';
import { resolveTarget } from '../external-target';
import { externalOpenApi } from '../external-openapi';
import { requestLogUrl } from '../../../common/request-logger.interceptor';

describe('External HTTP contract', () => {
  it('accepts canonical targets and actual public page URLs', () => {
    expect(resolveTarget('/note?node=ci_note')).toMatchObject({
      target: 'notes:ci_note',
    });
    expect(
      resolveTarget('/anthology?at=ci_parent&node=ci_child'),
    ).toMatchObject({ target: 'anthology:ci_child', parentId: 'ci_parent' });
    expect(resolveTarget('/gallery?post=ci_photo')).toMatchObject({
      target: 'gallery:ci_photo',
    });
    expect(resolveTarget('/digest/ci_topic/report_id')).toMatchObject({
      target: 'report:ci_topic:report_id',
    });
  });
  it.each([
    '/admin/notes/ci_private',
    'https://other.example/note?node=ci_one',
    '//other.example/note',
    '/note?node=ci_one&v=old',
    '/note?node=one&node=two',
    '/home?post=ci_one',
    '/gallery?at=ci_one',
    '/anthology?at=ci_parent',
  ])('rejects private, foreign or ambiguous URL %s', (input) => {
    expect(() => resolveTarget(input)).toThrow(BadRequestException);
  });
  it('rejects history/private selectors and malformed pagination', () => {
    expect(parseQuery(browseQuerySchema, {})).toEqual({ limit: 30 });
    expect(parseQuery(readQuerySchema, { target: 'notes:ci_one' })).toEqual({
      target: 'notes:ci_one',
      maxCharacters: 12000,
    });
    for (const query of [
      { visibility: 'all' },
      { versionId: 'private' },
      { limit: ['1', '2'] },
      { limit: 101 },
      { cursor: '' },
    ])
      expect(() => parseQuery(browseQuerySchema, query)).toThrow(
        BadRequestException,
      );
    expect(() => parseQuery(searchQuerySchema, { query: ' ' })).toThrow(
      BadRequestException,
    );
  });
  it('advertises exactly four read-only operations and bounded query schemas', () => {
    const spec = externalOpenApi();
    expect(Object.keys(spec.paths)).toHaveLength(4);
    expect(
      Object.values(spec.paths).map((path) => path.get.operationId),
    ).toEqual([
      'browse_library',
      'search_content',
      'read_content',
      'read_asset',
    ]);
    expect(
      spec.paths['/external/content'].get.parameters.find(
        (parameter) => parameter.name === 'target',
      )?.required,
    ).toBe(true);
  });
  it('provides HTTP onboarding instructions using the deployment origin, not a fixed local URL', () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      PUBLIC_SITE_URL: 'https://reading.example/',
    });
    try {
      const spec = externalOpenApi();
      expect(spec.servers).toEqual([{ url: 'https://reading.example/api/v1' }]);
      const instructions = spec['x-agent-instructions'];
      expect(instructions).toContain(
        'https://reading.example/api/v1/external/openapi.json',
      );
      for (const term of [
        'browse_library',
        'search_content',
        'read_content',
        'read_asset',
        'nextCursor',
        '公开页面 URL',
        '无法发送 HTTP 请求',
      ]) {
        expect(instructions).toContain(term);
      }
      expect(instructions).not.toContain('127.0.0.1');
      expect(instructions).not.toContain('lux-stirring.space');
      expect(Object.keys(spec.paths)).toHaveLength(4);
    } finally {
      jest.restoreAllMocks();
    }
  });
  it('does not log reference tokens or search text', () => {
    const url = requestLogUrl(
      '/api/v1/external/assets/secret?cursor=cursor-secret&sectionRef=section-secret&query=private-text',
    );
    for (const secret of ['secret', 'private-text'])
      expect(url).not.toContain(secret);
    expect(requestLogUrl('/api/v1/auth/check')).toBe('/api/v1/auth/check');
  });
});
