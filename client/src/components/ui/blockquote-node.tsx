'use client';

import { type PlateElementProps, PlateElement } from 'platejs/react';

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="blockquote"
      className="my-4 border-l-[3px] rounded-r-md py-0.5 pl-5 pr-4 text-ink-faded"
      style={{ borderColor: 'var(--ink-faded)', background: 'var(--shelf)' }}
      {...props}
    />
  );
}
