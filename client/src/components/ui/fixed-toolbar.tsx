'use client';

import { cn } from '@/lib/utils';

import { Toolbar } from './toolbar';

export function FixedToolbar(props: React.ComponentProps<typeof Toolbar>) {
  return (
    <Toolbar
      {...props}
      className={cn(
        /* w-max + 居中：配合编辑顶栏 grid 中列，工具条几何中心对齐视口；窄屏允许横向滚动 */
        'scrollbar-hide mx-auto flex w-max max-w-full flex-wrap items-center justify-center gap-x-1 px-3 py-1',
        props.className
      )}
    />
  );
}
