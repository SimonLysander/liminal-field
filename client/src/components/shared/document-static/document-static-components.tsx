import type { CSSProperties } from 'react';

import { getDateDisplayLabel } from '@platejs/date';
import { isOrderedList } from '@platejs/list';
import { getEquationHtml } from '@platejs/math';
import { getTableCellBorders } from '@platejs/table';
import { FileUp } from 'lucide-react';
import type {
  TDateElement,
  TElement,
  TEquationElement,
  TFileElement,
  TImageElement,
  TLinkElement,
  TTableCellElement,
  TTableElement,
} from 'platejs';
import { NodeApi } from 'platejs';
import type { SlateElementProps, SlateLeafProps } from 'platejs/static';
import { SlateElement, SlateLeaf } from 'platejs/static';

import {
  blockquoteClassName,
  blockquoteStyle,
  codeLeafClassName,
  dateClassName,
  dateLayoutClassName,
  equationBlockEmptyClassName,
  equationBlockFilledClassName,
  equationBlockLayoutClassName,
  equationBlockPresentationClassName,
  equationEmptyClassName,
  equationEmptyIconClassName,
  equationValueClassName,
  headingVariants,
  highlightLeafClassName,
  hrClassName,
  hrContainerClassName,
  inlineEquationContentClassName,
  kbdLeafClassName,
  linkClassName,
  listClassName,
  mediaFileCaptionClassName,
  mediaFileContentClassName,
  mediaFileElementClassName,
  mediaFileIconClassName,
  mediaFileLinkClassName,
  mediaImageClassName,
  mediaImageElementClassName,
  mediaImageFigureClassName,
  mediaImageLayoutClassName,
  mediaCaptionClassName,
  mediaCaptionStyle,
  paragraphClassName,
  tableBodyClassName,
  tableCellClassName,
  tableCellContentClassName,
  tableClassName,
  tableElementClassName,
  tableHeaderCellClassName,
  tableWrapperClassName,
  todoListCheckboxClassName,
  todoListCheckboxWrapperClassName,
  todoListCheckedClassName,
  todoListContentClassName,
  todoListItemClassName,
} from './document-node-styles';
import { StaticMediaPreview } from './document-static-media-preview';
import { cn } from '@/lib/utils';

type StaticElement = TElement & Record<string, unknown>;

function getCaptionText(element: StaticElement): string {
  const caption = element.caption;

  if (!Array.isArray(caption)) return '';

  return NodeApi.string({ children: caption } as TElement);
}

const equationOptions = {
  errorColor: '#cc0000',
  fleqn: false,
  leqno: false,
  macros: { '\\f': '#1f(#2)' },
  output: 'htmlAndMathml' as const,
  strict: 'warn' as const,
  throwOnError: false,
  trust: false,
};

export function StaticParagraphElement(props: SlateElementProps) {
  return <SlateElement {...props} className={paragraphClassName} />;
}

export function StaticListElement(props: SlateElementProps) {
  const element = props.element as StaticElement;
  const listStyleType = typeof element.listStyleType === 'string' ? element.listStyleType : undefined;
  const List = isOrderedList(element) ? 'ol' : 'ul';

  return (
    <SlateElement
      {...props}
      as={List}
      className={listClassName}
      attributes={{
        ...props.attributes,
        start: List === 'ol' ? (element.listStart as number | undefined) : undefined,
      }}
      style={{ listStyleType }}
    />
  );
}

export function StaticListItemElement(props: SlateElementProps) {
  const element = props.element as StaticElement;
  const isTodo = typeof element.checked === 'boolean';
  const checked = element.checked === true;

  if (!isTodo) return <SlateElement {...props} as="li" />;

  return (
    <SlateElement
      {...props}
      as="li"
      className={`${todoListItemClassName} ${checked ? todoListCheckedClassName : ''}`}
    >
      <span className={todoListCheckboxWrapperClassName}>
        <input checked={checked} className={todoListCheckboxClassName} readOnly type="checkbox" />
      </span>
      <span className={todoListContentClassName}>{props.children}</span>
    </SlateElement>
  );
}

export function StaticHeadingElement({
  variant,
  ...props
}: SlateElementProps & { variant: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' }) {
  return <SlateElement {...props} as={variant} className={headingVariants({ variant })} />;
}

export function StaticBlockquoteElement(props: SlateElementProps) {
  return <SlateElement {...props} as="blockquote" className={blockquoteClassName} style={blockquoteStyle} />;
}

export function StaticHrElement(props: SlateElementProps) {
  return (
    <SlateElement {...props}>
      <div className={hrContainerClassName}>
        <hr className={hrClassName} />
      </div>
      {props.children}
    </SlateElement>
  );
}

export function StaticLinkElement(props: SlateElementProps<TLinkElement>) {
  return (
    <SlateElement
      {...props}
      as="a"
      className={linkClassName}
      attributes={{ ...props.attributes, href: props.element.url, rel: 'noopener noreferrer', target: '_blank' }}
    />
  );
}

export function StaticDateElement(props: SlateElementProps<TDateElement>) {
  const label = getDateDisplayLabel(props.element);

  return (
    <SlateElement
      {...props}
      as="span"
      className={`${dateLayoutClassName} ${dateClassName}`}
      attributes={{ ...props.attributes, 'data-date-value': props.element.date ?? props.element.rawDate }}
    >
      {label}
    </SlateElement>
  );
}

export function StaticTableElement(props: SlateElementProps<TTableElement>) {
  return (
    <SlateElement {...props} className={tableElementClassName}>
      <div className={tableWrapperClassName}>
        <table className={tableClassName}>
          <tbody className={tableBodyClassName}>{props.children}</tbody>
        </table>
      </div>
    </SlateElement>
  );
}

export function StaticTableRowElement(props: SlateElementProps) {
  return <SlateElement {...props} as="tr" />;
}

export function StaticTableCellElement({
  isHeader = false,
  ...props
}: SlateElementProps<TTableCellElement> & { isHeader?: boolean }) {
  const element = props.element as TTableCellElement & { background?: string; colSpan?: number; rowSpan?: number };
  const cellStyle = element.background ? { background: element.background } : undefined;
  const borders = getTableCellBorders(props.editor, { element });

  return (
    <SlateElement
      {...props}
      as={isHeader ? 'th' : 'td'}
      className={cn(
        tableCellClassName,
        isHeader && tableHeaderCellClassName,
        'before:absolute before:box-border before:select-none before:size-full before:content-[\'\']',
        borders.bottom?.size && 'before:border-b before:border-b-border',
        borders.right?.size && 'before:border-r before:border-r-border',
        borders.left?.size && 'before:border-l before:border-l-border',
        borders.top?.size && 'before:border-t before:border-t-border',
      )}
      style={cellStyle}
      attributes={{ ...props.attributes, colSpan: element.colSpan, rowSpan: element.rowSpan }}
    >
      <div className={tableCellContentClassName}>{props.children}</div>
    </SlateElement>
  );
}

export function StaticImageElement(props: SlateElementProps<TImageElement>) {
  const element = props.element as TImageElement & StaticElement & { alt?: string };
  const alt = element.alt ?? '图片';
  const caption = getCaptionText(element);

  return (
    <SlateElement {...props} className={mediaImageElementClassName}>
      <figure className={mediaImageFigureClassName}>
        {typeof element.url === 'string' && element.url.length > 0 ? (
          <StaticMediaPreview
            alt={alt}
            className={`${mediaImageLayoutClassName} ${mediaImageClassName}`}
            imagePath={props.path}
            url={element.url}
            value={props.editor.children as TElement[]}
          />
        ) : (
          <span>{alt}</span>
        )}
        {caption && (
          <figcaption
            className={`${mediaCaptionClassName} text-center`}
            style={mediaCaptionStyle}
          >
            {caption}
          </figcaption>
        )}
        {props.children}
      </figure>
    </SlateElement>
  );
}

export function StaticFileElement(props: SlateElementProps<TFileElement>) {
  const element = props.element as TFileElement & StaticElement & { name?: string };
  const name = element.name ?? element.url ?? '文件';
  const caption = getCaptionText(element);

  return (
    <SlateElement {...props} className={mediaFileElementClassName}>
      {typeof element.url === 'string' && element.url.length > 0 ? (
        <a
          className={mediaFileLinkClassName}
          download={name}
          href={element.url}
          rel="noopener noreferrer"
          target="_blank"
        >
          <div className={mediaFileContentClassName}>
            <FileUp className={mediaFileIconClassName} />
            <span>{name}</span>
          </div>
        </a>
      ) : (
        <div className={mediaFileContentClassName}>
          <FileUp className={mediaFileIconClassName} />
          <span>{name}</span>
        </div>
      )}
      {caption && (
        <div
          className={`${mediaCaptionClassName} ${mediaFileCaptionClassName}`}
          style={mediaCaptionStyle}
        >
          {caption}
        </div>
      )}
      {props.children}
    </SlateElement>
  );
}

export function StaticCaptionElement(props: SlateElementProps) {
  return (
    <SlateElement
      {...props}
      as="figcaption"
      className={`${mediaCaptionClassName} text-center`}
      style={mediaCaptionStyle}
    />
  );
}

export function StaticEquationElement(props: SlateElementProps<TEquationElement>) {
  const expression = props.element.texExpression ?? '';
  const html = getEquationHtml({
    element: props.element,
    options: { ...equationOptions, displayMode: true },
  });

  return (
    <SlateElement {...props}>
      <div
        className={`min-w-0 overflow-x-auto ${equationBlockLayoutClassName} ${equationBlockPresentationClassName} ${
          expression ? equationBlockFilledClassName : equationBlockEmptyClassName
        }`}
      >
        {expression ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span className={equationEmptyClassName}>
            <span className={equationEmptyIconClassName}>+</span>
            Add a Tex equation
          </span>
        )}
      </div>
      {props.children}
    </SlateElement>
  );
}

export function StaticInlineEquationElement(props: SlateElementProps<TEquationElement>) {
  const expression = props.element.texExpression ?? '';
  const html = getEquationHtml({
    element: props.element,
    options: { ...equationOptions, displayMode: false },
  });

  return (
    <SlateElement {...props} as="span" className="inline-block">
      <span className={inlineEquationContentClassName}>
        {expression && <span className={equationValueClassName} dangerouslySetInnerHTML={{ __html: html }} />}
      </span>
      {props.children}
    </SlateElement>
  );
}

export function StaticBoldLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="strong" />;
}

export function StaticItalicLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="em" />;
}

export function StaticUnderlineLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="u" />;
}

export function StaticStrikethroughLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="s" />;
}

export function StaticCodeLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="code" className={codeLeafClassName} />;
}

export function StaticHighlightLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="mark" className={highlightLeafClassName} />;
}

export function StaticKbdLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="kbd" className={kbdLeafClassName} />;
}

export function StaticSubscriptLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="sub" />;
}

export function StaticSuperscriptLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} as="sup" />;
}

export function StaticFontColorLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} style={{ color: props.leaf.color as string | undefined }} />;
}

export function StaticFontBackgroundColorLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} style={{ backgroundColor: props.leaf.backgroundColor as string | undefined }} />;
}

export function StaticFontSizeLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} style={{ fontSize: props.leaf.fontSize as CSSProperties['fontSize'] }} />;
}

export function StaticFontFamilyLeaf(props: SlateLeafProps) {
  return <SlateLeaf {...props} style={{ fontFamily: props.leaf.fontFamily as string | undefined }} />;
}
