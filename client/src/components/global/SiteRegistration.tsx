import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';

export function SiteRegistration({ className }: { className?: string }) {
  return (
    <a
      href="https://beian.miit.gov.cn/"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'font-sans text-xs text-[var(--ink-faded)] underline-offset-4 hover:text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4',
        className,
      )}
    >
      {siteConfig.icpRecordNumber}
    </a>
  );
}
