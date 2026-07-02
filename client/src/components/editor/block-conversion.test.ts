import { describe, expect, it } from 'vitest';
import { KEYS } from 'platejs';

import {
  canSetTopLevelBlockType,
  canShowTurnInto,
} from './block-conversion';

describe('block conversion matrix', () => {
  it('allows text and list blocks to use Turn into', () => {
    for (const type of [
      KEYS.p,
      KEYS.h1,
      KEYS.h2,
      KEYS.h3,
      KEYS.h4,
      KEYS.h5,
      KEYS.h6,
      KEYS.blockquote,
      KEYS.ul,
      KEYS.ol,
      KEYS.listTodo,
    ]) {
      expect(canShowTurnInto(type), type).toBe(true);
    }
  });

  it('allows code blocks to expose only the explicit escape path', () => {
    expect(canShowTurnInto(KEYS.codeBlock)).toBe(true);
    expect(canSetTopLevelBlockType(KEYS.codeBlock, KEYS.p)).toBe(false);
  });

  it('does not expose Turn into for structural or void-like blocks', () => {
    for (const type of [
      KEYS.table,
      KEYS.tr,
      KEYS.td,
      KEYS.th,
      KEYS.img,
      KEYS.file,
      KEYS.hr,
      'equation',
      'placeholder',
    ]) {
      expect(canShowTurnInto(type), type).toBe(false);
      expect(canSetTopLevelBlockType(type, KEYS.p), type).toBe(false);
    }
  });

  it('only lets top-level path conversion target text/list menu types', () => {
    expect(canSetTopLevelBlockType(KEYS.p, KEYS.h2)).toBe(true);
    expect(canSetTopLevelBlockType(KEYS.p, KEYS.ul)).toBe(true);
    expect(canSetTopLevelBlockType(KEYS.ol, KEYS.blockquote)).toBe(true);

    expect(canSetTopLevelBlockType(KEYS.p, KEYS.codeBlock)).toBe(false);
    expect(canSetTopLevelBlockType(KEYS.p, KEYS.table)).toBe(false);
    expect(canSetTopLevelBlockType(KEYS.p, KEYS.img)).toBe(false);
  });
});
