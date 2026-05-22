'use client';

import * as React from 'react';

import {
  type FloatingToolbarState,
  flip,
  offset,
  useFloatingToolbar,
  useFloatingToolbarState,
} from '@platejs/floating';
import { useComposedRef } from '@udecode/cn';
import {
  useEditorId,
} from 'platejs/react';

import { cn } from '@/lib/utils';

import { Toolbar } from './toolbar';

export function FloatingToolbar({
  children,
  className,
  state,
  ...props
}: React.ComponentProps<typeof Toolbar> & {
  state?: FloatingToolbarState;
}) {
  const editorId = useEditorId();

  const floatingToolbarState = useFloatingToolbarState({
    editorId,
    // 单编辑器场景，当前编辑器始终视为聚焦
    focusedEditorId: editorId,
    ...state,
    floatingOptions: {
      middleware: [
        offset(12),
        flip({
          fallbackPlacements: [
            'top-start',
            'top-end',
            'bottom-start',
            'bottom-end',
          ],
          padding: 12,
        }),
      ],
      placement: 'top',
      ...state?.floatingOptions,
    },
  });

  const {
    clickOutsideRef,
    hidden,
    props: rootProps,
    ref: floatingRef,
  } = useFloatingToolbar(floatingToolbarState);

  const ref = useComposedRef<HTMLDivElement>(props.ref, floatingRef);

  if (hidden) return null;

  return (
    <div ref={clickOutsideRef}>
      <Toolbar
        {...props}
        {...rootProps}
        ref={ref}
        className={cn(
          'absolute z-50 overflow-x-auto whitespace-nowrap rounded-md border p-1 opacity-100 shadow-md print:hidden',
          'max-w-[80vw]',
          className
        )}
        style={{
          ...rootProps.style,
          background: 'var(--popover, var(--paper-dark))',
          borderColor: 'var(--box-border, var(--separator))',
        }}
      >
        {children}
      </Toolbar>
    </div>
  );
}
