'use client';

import type { PlateElementProps } from 'platejs/react';

import { PlateElement } from 'platejs/react';

import { paragraphClassName } from '@/components/shared/document-static/document-node-styles';

export function ParagraphElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className={paragraphClassName}>
      {props.children}
    </PlateElement>
  );
}
