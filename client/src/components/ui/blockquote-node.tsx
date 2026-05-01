'use client';

import { type PlateElementProps, PlateElement } from 'platejs/react';

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="blockquote"
      className="my-4 border-l-2 border-ink-ghost pl-6 italic"
      {...props}
    />
  );
}
