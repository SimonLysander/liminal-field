import { describe, expect, it } from 'vitest';
import { pathToSpace, spaces, spaceToPath } from '../nav-spaces';

describe('public navigation spaces', () => {
  it.each(spaces)('maps the %s navigation destination back to its space', (space) => {
    expect(pathToSpace(spaceToPath(space))).toBe(space);
  });

  it('keeps nested content routes in their space', () => {
    expect(pathToSpace('/digest/topic/report')).toBe('digest');
    expect(pathToSpace('/anthology/entry')).toBe('anthology');
  });

  it.each(['/connect', '/missing-page', '/'])('does not select notes for %s', (path) => {
    expect(pathToSpace(path)).toBeUndefined();
  });
});
