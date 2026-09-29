import { BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ExternalReferenceService } from '../external-reference.service';

describe('External reference isolation', () => {
  let service: ExternalReferenceService;
  const originalSecret = process.env.JWT_SECRET;
  beforeEach(() => {
    process.env.JWT_SECRET = 'reference-test-secret';
    service = new ExternalReferenceService();
  });
  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('round trips purpose-bound references but cannot authenticate an administrator', () => {
    const reference = {
      kind: 'asset',
      target: 'notes:ci_one',
      revision: 'revision',
      fileName: 'photo.png',
    } as const;
    const token = service.encode(reference);
    expect(service.decode(token)).toEqual(reference);
    expect(() =>
      new JwtService().verify(token, { secret: process.env.JWT_SECRET }),
    ).toThrow();
  });
  it('rejects login credentials, tampering, oversized tokens, and wrong cursor purpose', () => {
    const login = new JwtService().sign(
      { role: 'admin' },
      { secret: process.env.JWT_SECRET },
    );
    const token = service.encode({
      kind: 'section',
      target: 'notes:ci_one',
      revision: 'r',
      index: 0,
    });
    for (const invalid of [login, `${token}x`, 'x'.repeat(4097)])
      expect(() => service.decode(invalid)).toThrow(BadRequestException);
    expect(() => service.offset(token, 'browse:notes', 'r')).toThrow(
      BadRequestException,
    );
  });
  it('binds pagination to both the query and current published result', () => {
    const first = service.page(['a', 'b', 'c'], 1, undefined, 'browse:notes');
    expect(
      service.page(['a', 'b', 'c'], 2, first.nextCursor!, 'browse:notes'),
    ).toMatchObject({ items: ['b', 'c'], nextCursor: null });
    expect(() =>
      service.page(['a', 'b', 'c'], 1, first.nextCursor!, 'browse:gallery'),
    ).toThrow(BadRequestException);
    expect(() =>
      service.page(['a', 'changed', 'c'], 1, first.nextCursor!, 'browse:notes'),
    ).toThrow(ConflictException);
  });
});
