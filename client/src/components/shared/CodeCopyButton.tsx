import * as React from 'react';

import { CheckIcon, CopyIcon } from 'lucide-react';

import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';

const logger = createLogger('code-copy');

type CodeCopyButtonProps = {
  copyAriaLabel?: string;
  copyTitle?: string;
  value: (() => string) | string;
} & Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'title' | 'value'>;

export function CodeCopyButton({
  copyAriaLabel = '复制全部代码',
  copyTitle = copyAriaLabel,
  value,
  children,
  ...props
}: CodeCopyButtonProps) {
  const [hasCopied, setHasCopied] = React.useState(false);
  const [copying, setCopying] = React.useState(false);

  React.useEffect(() => {
    if (!hasCopied) return;

    const timeout = window.setTimeout(() => setHasCopied(false), 1500);

    return () => window.clearTimeout(timeout);
  }, [hasCopied]);

  const handleCopy = async () => {
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable');
      }
      await navigator.clipboard.writeText(typeof value === 'function' ? value() : value);
      setHasCopied(true);
      logger.debug('clipboard.written');
    } catch (error) {
      setHasCopied(false);
      logger.warn('clipboard.failed', { error: String(error) });
      banner.error('复制失败，请选择文本复制');
    } finally {
      setCopying(false);
    }
  };

  return (
    <Button
      {...props}
      type="button"
      disabled={copying || props.disabled}
      aria-label={hasCopied ? '已复制' : copyAriaLabel}
      title={hasCopied ? '已复制' : copyTitle}
      onClick={() => void handleCopy()}
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
      {children}
    </Button>
  );
}
