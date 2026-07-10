'use client';

import type { TInlineSuggestionData, TLinkElement } from 'platejs';
import type { PlateElementProps } from 'platejs/react';

import { getLinkAttributes } from '@platejs/link';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import { PlateElement } from 'platejs/react';

import { linkClassName } from '@/components/shared/document-static/document-node-styles';
import { cn } from '@/lib/utils';

export function LinkElement(props: PlateElementProps<TLinkElement>) {
  // SuggestionPlugin may not be registered; use optional chaining to avoid crash
  const suggestionData = props.editor
    .getApi(SuggestionPlugin)
    .suggestion?.suggestionData(props.element) as
    | TInlineSuggestionData
    | undefined;

  return (
    <PlateElement
      {...props}
      as="a"
      className={cn(
        linkClassName,
        suggestionData?.type === 'remove' && 'bg-red-100 text-red-700',
        suggestionData?.type === 'insert' && 'bg-emerald-100 text-emerald-700'
      )}
      attributes={{
        ...props.attributes,
        ...getLinkAttributes(props.editor, props.element),
        onMouseOver: (e) => {
          e.stopPropagation();
        },
      }}
    >
      {props.children}
    </PlateElement>
  );
}
