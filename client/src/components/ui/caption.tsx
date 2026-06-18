'use client';

import * as React from 'react';

import type { VariantProps } from 'class-variance-authority';

import {
  Caption as CaptionPrimitive,
  CaptionTextarea as CaptionTextareaPrimitive,
  useCaptionButton,
  useCaptionButtonState,
} from '@platejs/caption/react';
import { createPrimitiveComponent } from '@udecode/cn';
import { cva } from 'class-variance-authority';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const captionVariants = cva('max-w-full', {
  defaultVariants: {
    align: 'center',
  },
  variants: {
    align: {
      center: 'mx-auto',
      left: 'mr-auto',
      right: 'ml-auto',
    },
  },
});

export function Caption({
  align,
  className,
  ...props
}: React.ComponentProps<typeof CaptionPrimitive> &
  VariantProps<typeof captionVariants>) {
  return (
    <CaptionPrimitive
      {...props}
      className={cn(captionVariants({ align }), className)}
    />
  );
}

export function CaptionTextarea(
  props: React.ComponentProps<typeof CaptionTextareaPrimitive>,
) {
  return (
    <CaptionTextareaPrimitive
      {...props}
      className={cn(
        // 视觉上跟正文区分：
        //   - text-xs（12px）vs 正文 ~16px → 一眼小一号
        //   - --ink-ghost 灰色 vs 正文 --ink → 弱化对比
        //   - text-center 居中 vs 正文左对齐 → 排版上独立
        //   - mt-1.5 顶部小留白 → 跟图片之间有节奏
        'mt-1.5 w-full resize-none border-none bg-transparent p-0 text-xs',
        'text-center placeholder:text-[var(--ink-ghost)]',
        'focus:outline-none focus:[&::placeholder]:opacity-0',
        'print:placeholder:text-transparent',
        props.className,
      )}
      style={{ color: 'var(--ink-ghost)', ...props.style }}
    />
  );
}

export const CaptionButton = createPrimitiveComponent(Button)({
  propsHook: useCaptionButton,
  stateHook: useCaptionButtonState,
});
