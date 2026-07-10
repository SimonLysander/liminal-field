'use client';

import { type PlateElementProps, PlateElement } from 'platejs/react';

import {
  blockquoteClassName,
  blockquoteStyle,
} from '@/components/shared/document-static/document-node-styles';

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="blockquote"
      className={blockquoteClassName}
      style={blockquoteStyle}
      {...props}
    />
  );
}
