import type { TCodeBlockElement, TCodeSyntaxLeaf } from 'platejs';
import { NodeApi } from 'platejs';
import type { SlateElementProps, SlateLeafProps } from 'platejs/static';
import { SlateElement, SlateLeaf } from 'platejs/static';

import { CodeCopyButton } from '@/components/shared/CodeCopyButton';
import { getCodeLanguageLabel } from '@/components/shared/code-languages';
import {
  codeBlockClassName,
  codeBlockCodeClassName,
  codeBlockPreClassName,
  codeBlockPreStyle,
  codeLineClassName,
} from '@/components/shared/document-static/document-node-styles';

export function StaticCodeBlockElement(props: SlateElementProps<TCodeBlockElement>) {
  const code = props.element.children.map((line) => NodeApi.string(line)).join('\n');
  const language = props.element.lang ?? 'plaintext';
  const languageLabel = getCodeLanguageLabel(language);

  return (
    <SlateElement {...props}>
      <div className={codeBlockClassName} data-code-language={language}>
        <div
          className="flex items-center justify-end gap-0.5 border-b px-2 py-1"
          style={{ borderColor: 'color-mix(in srgb, var(--ink) 6%, transparent)' }}
        >
          {languageLabel ? (
            <span className="flex h-6 select-none items-center gap-1 px-2 text-muted-foreground text-xs">
              {languageLabel}
            </span>
          ) : null}
          <CodeCopyButton
            size="icon"
            variant="ghost"
            className="size-6 gap-1 text-muted-foreground text-xs"
            value={code}
          />
        </div>
        <pre className={codeBlockPreClassName} style={codeBlockPreStyle}>
          <code className={codeBlockCodeClassName}>{props.children}</code>
        </pre>
      </div>
    </SlateElement>
  );
}

export function StaticCodeLineElement(props: SlateElementProps) {
  return <SlateElement {...props} className={codeLineClassName} />;
}

export function StaticCodeSyntaxLeaf(props: SlateLeafProps<TCodeSyntaxLeaf>) {
  return <SlateLeaf {...props} className={props.leaf.className as string | undefined} />;
}
