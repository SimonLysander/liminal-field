import { BadRequestException } from '@nestjs/common';
import type { LibraryScope } from './external-read.contract';

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
export type LibraryTarget =
  | { kind: 'root'; target: 'library' }
  | { kind: 'scope'; target: LibraryScope; scope: LibraryScope }
  | {
      kind: 'content';
      target: string;
      scope: LibraryScope;
      id: string;
      parentId?: string;
    }
  | {
      kind: 'report';
      target: string;
      scope: 'digest';
      id: string;
      topicId: string;
    }
  | { kind: 'node'; target: string; scope: 'notes'; id: string };

export function siteUrl(): string {
  const url = new URL(
    process.env.PUBLIC_SITE_URL || 'https://lux-stirring.space',
  );
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('PUBLIC_SITE_URL must be an HTTP(S) origin');
  return url.origin;
}

function checkedId(id: string | null): string {
  if (!id || !idPattern.test(id))
    throw new BadRequestException('INVALID_TARGET');
  return id;
}

/** URLs are identifiers only: no network fetch, private route, or version selector. */
export function resolveTarget(input = 'library'): LibraryTarget {
  if (input === 'library' || input === '/home' || input === '/')
    return { kind: 'root', target: 'library' };
  if (['notes', 'anthology', 'gallery', 'digest'].includes(input)) {
    const scope = input as LibraryScope;
    return { kind: 'scope', target: scope, scope };
  }
  const parts = input.split(':');
  if (
    parts.length === 2 &&
    ['notes', 'anthology', 'gallery', 'digest'].includes(parts[0])
  ) {
    const scope = parts[0] as LibraryScope;
    const id = checkedId(parts[1]);
    return { kind: 'content', target: `${scope}:${id}`, scope, id };
  }
  if (parts.length === 3 && parts[0] === 'report') {
    const topicId = checkedId(parts[1]);
    const id = checkedId(parts[2]);
    return {
      kind: 'report',
      target: `report:${topicId}:${id}`,
      scope: 'digest',
      id,
      topicId,
    };
  }
  if (parts.length === 2 && parts[0] === 'node') {
    const id = checkedId(parts[1]);
    return { kind: 'node', target: `node:${id}`, scope: 'notes', id };
  }
  if (!input.startsWith('/') && !/^https?:\/\//.test(input))
    throw new BadRequestException('INVALID_TARGET');
  let url: URL;
  try {
    url = new URL(input, siteUrl());
  } catch {
    throw new BadRequestException('INVALID_TARGET');
  }
  if (url.origin !== new URL(siteUrl()).origin || url.username || url.password)
    throw new BadRequestException('INVALID_TARGET');
  const allowed =
    url.pathname === '/note' ||
    url.pathname === '/notes' ||
    url.pathname === '/anthology'
      ? ['at', 'node']
      : url.pathname === '/gallery'
        ? ['post']
        : [];
  if (
    [...url.searchParams.keys()].some(
      (key) =>
        !allowed.includes(key) || url.searchParams.getAll(key).length !== 1,
    )
  )
    throw new BadRequestException('INVALID_TARGET');
  if (url.pathname === '/home' || url.pathname === '/') return resolveTarget();
  if (url.pathname === '/note' || url.pathname === '/notes') {
    if (url.searchParams.has('node'))
      return resolveTarget(`notes:${checkedId(url.searchParams.get('node'))}`);
    if (url.searchParams.has('at'))
      return resolveTarget(`node:${checkedId(url.searchParams.get('at'))}`);
    return resolveTarget('notes');
  }
  if (url.pathname === '/anthology') {
    if (!url.searchParams.has('node')) {
      if (url.searchParams.has('at'))
        throw new BadRequestException('INVALID_TARGET');
      return resolveTarget('anthology');
    }
    return {
      kind: 'content',
      scope: 'anthology',
      id: checkedId(url.searchParams.get('node')),
      target: `anthology:${checkedId(url.searchParams.get('node'))}`,
      ...(url.searchParams.has('at')
        ? { parentId: checkedId(url.searchParams.get('at')) }
        : {}),
    };
  }
  if (url.pathname === '/gallery') {
    return url.searchParams.has('post')
      ? resolveTarget(`gallery:${checkedId(url.searchParams.get('post'))}`)
      : resolveTarget('gallery');
  }
  const digest = url.pathname.split('/').filter(Boolean);
  if (digest[0] === 'digest' && digest.length <= 3) {
    if (digest.length === 1) return resolveTarget('digest');
    if (digest.length === 2)
      return resolveTarget(`digest:${checkedId(digest[1])}`);
    return resolveTarget(
      `report:${checkedId(digest[1])}:${checkedId(digest[2])}`,
    );
  }
  throw new BadRequestException('INVALID_TARGET');
}
