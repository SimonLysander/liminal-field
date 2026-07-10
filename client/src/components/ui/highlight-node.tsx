'use client';

import type { PlateLeafProps } from 'platejs/react';

import { PlateLeaf } from 'platejs/react';

import { highlightLeafClassName } from '@/components/shared/document-static/document-node-styles';

export function HighlightLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="mark" className={highlightLeafClassName}>
      {props.children}
    </PlateLeaf>
  );
}
