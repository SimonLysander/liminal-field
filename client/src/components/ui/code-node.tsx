'use client';

import type { PlateLeafProps } from 'platejs/react';

import { PlateLeaf } from 'platejs/react';

import { codeLeafClassName } from '@/components/shared/document-static/document-node-styles';

export function CodeLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      {...props}
      as="code"
      className={codeLeafClassName}
    >
      {props.children}
    </PlateLeaf>
  );
}
