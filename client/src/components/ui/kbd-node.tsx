'use client';

import type { PlateLeafProps } from 'platejs/react';

import { PlateLeaf } from 'platejs/react';

import { kbdLeafClassName } from '@/components/shared/document-static/document-node-styles';

export function KbdLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      {...props}
      as="kbd"
      className={kbdLeafClassName}
    >
      {props.children}
    </PlateLeaf>
  );
}
