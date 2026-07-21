import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@platejs/math', async () => {
  const { createSlatePlugin } = await import('platejs');

  return {
    BaseEquationPlugin: createSlatePlugin({ key: 'equation', node: { isElement: true } }),
    BaseInlineEquationPlugin: createSlatePlugin({
      key: 'inline_equation',
      node: { isElement: true },
    }),
    getEquationHtml: () => '',
  };
});

import PlateReadOnly from '../PlateReadOnly';

describe('PlateReadOnly', () => {
  it('renders Markdown through static DOM and marks headings before notifying the TOC', async () => {
    const onHeadingsMarked = vi.fn();
    const { container } = render(
      <PlateReadOnly
        headingNumbering="note"
        markdown={'# First heading\n\n## Second heading\n\n## Third heading\n\n# Fourth heading\n\n## Fifth heading\n\nVisible body'}
        onHeadingsMarked={onHeadingsMarked}
      />,
    );

    const firstHeading = await screen.findByRole(
      'heading',
      { name: 'First heading' },
      { timeout: 3000 },
    );

    await waitFor(() => {
      expect(onHeadingsMarked).toHaveBeenCalledTimes(1);
    });

    expect(firstHeading).toHaveAttribute('data-heading-id', 'heading-0');
    expect(firstHeading).toHaveAttribute('data-heading-number', '一、');
    expect(screen.getByRole('heading', { name: 'Second heading' })).toHaveAttribute(
      'data-heading-id',
      'heading-1',
    );
    expect(screen.getByRole('heading', { name: 'Second heading' })).toHaveAttribute(
      'data-heading-number',
      '1.1',
    );
    expect(screen.getByRole('heading', { name: 'Fifth heading' })).toHaveAttribute(
      'data-heading-number',
      '2.1',
    );
    expect(container.firstElementChild).toHaveClass('heading-numbering-note');
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('replaces rendered content when Markdown changes', async () => {
    const { rerender } = render(<PlateReadOnly markdown="# First version" />);

    await screen.findByRole('heading', { name: 'First version' });

    rerender(<PlateReadOnly markdown="# Second version" />);

    await screen.findByRole('heading', { name: 'Second version' });
    expect(screen.queryByRole('heading', { name: 'First version' })).toBeNull();
  });

  it('keeps malformed Markdown readable without throwing', async () => {
    render(<PlateReadOnly markdown="[unfinished link](" />);

    expect(await screen.findByText('[unfinished link](')).toBeInTheDocument();
  });
});
