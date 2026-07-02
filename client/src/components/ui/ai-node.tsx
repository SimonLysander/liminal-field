'use client';

import { AIChatPlugin } from '@platejs/ai/react';
import { type PlateElementProps, type PlateTextProps, PlateElement, PlateText, usePluginOption } from 'platejs/react';

import { cn } from '@/lib/utils';

export function AILeaf(props: PlateTextProps) {
  const streaming = usePluginOption(AIChatPlugin, 'streaming');
  const streamingLeaf = props.editor.getApi(AIChatPlugin).aiChat.node({ streaming: true });
  const isLast = streamingLeaf?.[0] === props.text;

  return (
    <PlateText
      className={cn(
        'rounded-[2px] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-[2px] text-[var(--accent)] underline decoration-[var(--accent-border)] decoration-2 [text-decoration-skip-ink:none]',
        'transition-colors duration-150',
        isLast &&
          streaming &&
          'after:ml-1.5 after:inline-block after:size-2 after:rounded-full after:bg-[var(--accent)] after:align-middle after:content-[""]'
      )}
      {...props}
    />
  );
}

export function AIAnchorElement(props: PlateElementProps) {
  return (
    <PlateElement {...props}>
      <div className="h-px" />
    </PlateElement>
  );
}
