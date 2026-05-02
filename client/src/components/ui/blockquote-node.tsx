'use client';

import { type PlateElementProps, PlateElement } from 'platejs/react';

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="blockquote"
      className="my-4 border-l-[3px] py-0.5 pl-5 text-ink-faded"
      style={{ borderColor: 'var(--pip-a)' }}
      {...props}
    />
  );
}
