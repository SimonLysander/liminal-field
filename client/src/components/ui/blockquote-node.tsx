'use client';

import { type PlateElementProps, PlateElement } from 'platejs/react';

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="blockquote"
      className="my-4 border-l-2 py-0.5 pl-5 pr-4 text-ink-faded"
      style={{ borderColor: 'var(--ink)', background: 'var(--shelf)' }}
      {...props}
    />
  );
}
