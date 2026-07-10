import * as React from 'react';

import { CheckIcon, CopyIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type CodeCopyButtonProps = {
  copyAriaLabel?: string;
  copyTitle?: string;
  value: (() => string) | string;
} & Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'title' | 'value'>;

export function CodeCopyButton({
  copyAriaLabel = '复制全部代码',
  copyTitle = copyAriaLabel,
  value,
  ...props
}: CodeCopyButtonProps) {
  const [hasCopied, setHasCopied] = React.useState(false);

  React.useEffect(() => {
    if (!hasCopied) return;

    const timeout = window.setTimeout(() => setHasCopied(false), 1500);

    return () => window.clearTimeout(timeout);
  }, [hasCopied]);

  return (
    <Button
      aria-label={hasCopied ? '已复制' : copyAriaLabel}
      title={hasCopied ? '已复制' : copyTitle}
      onClick={() => {
        void navigator.clipboard.writeText(typeof value === 'function' ? value() : value);
        setHasCopied(true);
      }}
      {...props}
    >
      <span className="relative inline-flex items-center">
        <CopyIcon
          className={cn(
            '!size-3 transition-opacity duration-150',
            hasCopied ? 'opacity-0' : 'opacity-100',
          )}
        />
        <CheckIcon
          className={cn(
            '!size-3 absolute left-0 top-0 transition-opacity duration-150',
            hasCopied ? 'opacity-100' : 'opacity-0',
          )}
          style={{ color: 'var(--accent)' }}
        />
      </span>
    </Button>
  );
}
