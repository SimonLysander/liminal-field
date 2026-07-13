import { describe, expect, it } from 'vitest';
import {
  applyHeadingNumbering,
  getHeadingNumberingClass,
  getNoteHeadingNumbers,
} from './heading-numbering';

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

  it('restarts H2 numbering when a new H1 begins', () => {
    expect(getNoteHeadingNumbers([1, 2, 2, 1, 2, 2])).toEqual([
      '一、',
      '1.1',
      '1.2',
      '二、',
      '2.1',
      '2.2',
    ]);
  });

  it('does not invent a parent number for H2 before the first H1', () => {
    expect(getNoteHeadingNumbers([2, 1, 2])).toEqual(['', '一、', '1.1']);
  });

  it('applies calculated numbers as display-only heading attributes', () => {
    const container = document.createElement('article');
    container.innerHTML = '<h1>First</h1><h2>One</h2><h2>Two</h2><h1>Second</h1><h2>Three</h2>';

    applyHeadingNumbering(container, 'note');

    expect(
      Array.from(container.querySelectorAll('h1, h2')).map(
        (heading) => heading.getAttribute('data-heading-number'),
      ),
    ).toEqual(['一、', '1.1', '1.2', '二、', '2.1']);
  });
});
