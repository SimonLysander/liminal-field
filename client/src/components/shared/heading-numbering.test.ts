import { describe, expect, it } from 'vitest';
import { getHeadingNumberingClass } from './heading-numbering';

describe('getHeadingNumberingClass', () => {
  it('maps explicit modes to semantic classes', () => {
    expect(getHeadingNumberingClass('note')).toBe('heading-numbering-note');
    expect(getHeadingNumberingClass('anthology')).toBe(
      'heading-numbering-anthology',
    );
  });

  it('does not add numbering for none or missing inputs', () => {
    expect(getHeadingNumberingClass('none')).toBe('');
    expect(getHeadingNumberingClass(undefined)).toBe('');
  });
});
