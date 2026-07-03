import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { buildCopyPageMarkdown, type CopyPageMarkdownInput } from './copy-page';

type CopyPageButtonProps = {
  page: CopyPageMarkdownInput;
  className?: string;
};

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const ok = document.execCommand('copy');
    if (!ok) throw new Error('execCommand copy failed');
  } finally {
    document.body.removeChild(textarea);
  }
}

export function CopyPageButton({
  page,
  className,
}: CopyPageButtonProps) {
  const [copied, setCopied] = useState(false);
  const label = '复制页面';

  const handleCopy = async () => {
    const text = buildCopyPageMarkdown(page);
    if (!text) {
      banner.error('没有可复制的内容');
      return;
    }

    try {
      await writeClipboard(text);
      setCopied(true);
      banner.success('已复制页面');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      banner.error('复制失败');
    }
  };

  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
              className,
            )}
            style={{ color: copied ? 'var(--accent)' : 'var(--ink-faded)' }}
            aria-label={label}
          >
            <Icon size={14} strokeWidth={1.8} />
            <span>{copied ? '已复制' : label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
