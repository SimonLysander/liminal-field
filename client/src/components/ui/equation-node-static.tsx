import type { TEquationElement } from 'platejs';
import type { SlateElementProps } from 'platejs/static';

import { getEquationHtml } from '@platejs/math';
import { RadicalIcon } from 'lucide-react';
import { SlateElement } from 'platejs/static';

import {
  equationBlockEmptyClassName,
  equationBlockFilledClassName,
  equationBlockLayoutClassName,
  equationBlockPresentationClassName,
  equationDocxBlockStyle,
  equationDocxEmptyStyle,
  equationDocxInlineStyle,
  equationEmptyClassName,
  equationEmptyIconClassName,
  equationValueClassName,
  inlineEquationContentClassName,
} from '@/components/shared/document-static/document-node-styles';
import { cn } from '@/lib/utils';
import { inlineSuggestionVariants } from '@/lib/suggestion';

export function EquationElementStatic(
  props: SlateElementProps<TEquationElement>
) {
  const { element } = props;

  const html = getEquationHtml({
    element,
    options: {
      displayMode: true,
      errorColor: '#cc0000',
      fleqn: false,
      leqno: false,
      macros: { '\\f': '#1f(#2)' },
      output: 'htmlAndMathml',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    },
  });

  return (
    <SlateElement className="my-1" {...props}>
      <div
        className={cn(
          equationBlockLayoutClassName,
          equationBlockPresentationClassName,
          'hover:bg-primary/10 data-[selected=true]:bg-primary/10',
          element.texExpression.length === 0
            ? equationBlockEmptyClassName
            : equationBlockFilledClassName
        )}
      >
        {element.texExpression.length > 0 ? (
          <span
            dangerouslySetInnerHTML={{
              __html: html,
            }}
          />
        ) : (
          <div className={equationEmptyClassName}>
            <RadicalIcon className={equationEmptyIconClassName} />
            <div>Add a Tex equation</div>
          </div>
        )}
      </div>
      {props.children}
    </SlateElement>
  );
}

export function InlineEquationElementStatic(
  props: SlateElementProps<TEquationElement>
) {
  const html = getEquationHtml({
    element: props.element,
    options: {
      displayMode: true,
      errorColor: '#cc0000',
      fleqn: false,
      leqno: false,
      macros: { '\\f': '#1f(#2)' },
      output: 'htmlAndMathml',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    },
  });

  return (
    <SlateElement
      {...props}
      className="inline-block select-none rounded-sm [&_.katex-display]:my-0"
    >
      <div
        className={cn(
          inlineEquationContentClassName,
          'h-6',
          inlineSuggestionVariants(),
          props.element.texExpression.length === 0 &&
            'text-muted-foreground after:bg-neutral-500/10'
        )}
      >
        <span
          className={cn(
            props.element.texExpression.length === 0 && 'hidden',
            equationValueClassName
          )}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      {props.children}
    </SlateElement>
  );
}

/**
 * DOCX-compatible block equation component.
 * Displays LaTeX source code with styling.
 */
export function EquationElementDocx(
  props: SlateElementProps<TEquationElement>
) {
  const { element } = props;

  if (!element.texExpression || element.texExpression.length === 0) {
    return (
      <SlateElement {...props}>
        <p style={equationDocxEmptyStyle}>[Empty equation]</p>
        {props.children}
      </SlateElement>
    );
  }

  return (
    <SlateElement {...props}>
      <p
        style={equationDocxBlockStyle}
      >
        {element.texExpression}
      </p>
      {props.children}
    </SlateElement>
  );
}

/**
 * DOCX-compatible inline equation component.
 * Displays LaTeX source code inline.
 */
export function InlineEquationElementDocx(
  props: SlateElementProps<TEquationElement>
) {
  const { element } = props;

  if (!element.texExpression || element.texExpression.length === 0) {
    return (
      <SlateElement {...props} as="span">
        <span style={equationDocxEmptyStyle}>[equation]</span>
        {props.children}
      </SlateElement>
    );
  }

  return (
    <SlateElement {...props} as="span">
      <span style={equationDocxInlineStyle}>
        {element.texExpression}
      </span>
      {props.children}
    </SlateElement>
  );
}
