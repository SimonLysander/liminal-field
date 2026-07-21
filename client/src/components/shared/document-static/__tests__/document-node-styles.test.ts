// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  blockquoteClassName,
  blockquoteStyle,
  headingVariants,
  hrClassName,
  hrContainerClassName,
  listClassName,
  paragraphClassName,
} from '../document-node-styles';

describe('document node presentation styles', () => {
  it('freezes the existing paragraph and heading class strings', () => {
    expect(paragraphClassName).toBe('m-0 px-0 py-1');
    expect(headingVariants({ variant: 'h1' })).toBe(
      'relative mb-1 text-ink data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-(--color-highlight) mt-[1.6em] pb-1 font-bold font-heading text-3xl tracking-[-0.02em]',
    );
    expect(headingVariants({ variant: 'h2' })).toBe(
      'relative mb-1 text-ink data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-(--color-highlight) mt-[1.4em] pb-px font-heading font-semibold text-2xl tracking-[-0.015em]',
    );
    expect(headingVariants({ variant: 'h3' })).toBe(
      'relative mb-1 text-ink data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-(--color-highlight) mt-[1em] pb-px font-heading font-semibold text-xl',
    );
    expect(headingVariants({ variant: 'h4' })).toBe(
      'relative mb-1 text-ink data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-(--color-highlight) mt-[0.75em] font-heading font-semibold text-lg',
    );
    expect(headingVariants({ variant: 'h5' })).toBe(
      'relative mb-1 text-ink data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-(--color-highlight) mt-[0.75em] font-semibold text-lg',
    );
    expect(headingVariants({ variant: 'h6' })).toBe(
      'relative mb-1 text-ink data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-(--color-highlight) mt-[0.75em] font-semibold text-base',
    );
  });

  it('freezes the existing blockquote and horizontal-rule presentation values', () => {
    expect(blockquoteClassName).toBe(
      'my-4 border-l-2 py-0.5 pl-5 pr-4 text-ink-faded',
    );
    expect(blockquoteStyle).toEqual({
      background: 'var(--shelf)',
      borderColor: 'var(--ink-light)',
    });
    expect(hrContainerClassName).toBe('py-6');
    expect(hrClassName).toBe(
      'h-0.5 rounded-sm border-none bg-muted bg-clip-content',
    );
  });

  it('keeps list markers within the document column', () => {
    expect(listClassName).toBe('relative m-0 pl-6');
  });
});
