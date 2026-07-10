import type { TCodeBlockElement, TCodeSyntaxLeaf } from 'platejs';
import { NodeApi } from 'platejs';
import type { SlateElementProps, SlateLeafProps } from 'platejs/static';
import { SlateElement, SlateLeaf } from 'platejs/static';

import { CodeCopyButton } from '@/components/shared/CodeCopyButton';
import {
  codeBlockClassName,
  codeBlockCodeClassName,
  codeBlockPreClassName,
  codeBlockPreStyle,
  codeLineClassName,
} from '@/components/shared/document-static/document-node-styles';

export function StaticCodeBlockElement(props: SlateElementProps<TCodeBlockElement>) {
  const code = props.element.children.map((line) => NodeApi.string(line)).join('\n');

  return (
    <SlateElement {...props}>
      <div className={codeBlockClassName} data-code-language={props.element.lang ?? 'plaintext'}>
        <CodeCopyButton value={code} />
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
