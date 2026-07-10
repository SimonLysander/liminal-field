import { cva } from 'class-variance-authority';

export const paragraphClassName = 'm-0 px-0 py-1';

export const headingVariants = cva(
  'relative mb-1 text-ink data-[nav-target=true]:rounded-md data-[nav-target=true]:bg-(--color-highlight)',
  {
    variants: {
      variant: {
        h1: 'mt-[1.6em] pb-1 font-bold font-heading text-3xl tracking-[-0.02em]',
        h2: 'mt-[1.4em] pb-px font-heading font-semibold text-2xl tracking-[-0.015em]',
        h3: 'mt-[1em] pb-px font-heading font-semibold text-xl',
        h4: 'mt-[0.75em] font-heading font-semibold text-lg',
        h5: 'mt-[0.75em] font-semibold text-lg',
        h6: 'mt-[0.75em] font-semibold text-base',
      },
    },
  },
);

export const blockquoteClassName =
  'my-4 border-l-2 py-0.5 pl-5 pr-4 text-ink-faded';
export const blockquoteStyle = {
  borderColor: 'var(--ink-light)',
  background: 'var(--shelf)',
} as const;

export const hrContainerClassName = 'py-6';
export const hrClassName =
  'h-0.5 rounded-sm border-none bg-muted bg-clip-content';

export const codeLeafClassName =
  'whitespace-pre-wrap rounded-md bg-muted px-[0.3em] py-[0.2em] font-mono text-sm';
export const highlightLeafClassName = 'bg-highlight/30 text-inherit';
export const kbdLeafClassName =
  'rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-sm shadow-[rgba(255,_255,_255,_0.1)_0px_0.5px_0px_0px_inset,_rgb(248,_249,_250)_0px_1px_5px_0px_inset,_rgb(193,_200,_205)_0px_0px_0px_0.5px,_rgb(193,_200,_205)_0px_2px_1px_-1px,_rgb(193,_200,_205)_0px_1px_0px_0px] dark:shadow-[rgba(255,_255,_255,_0.1)_0px_0.5px_0px_0px_inset,_rgb(26,_29,_30)_0px_1px_5px_0px_inset,_rgb(76,_81,_85)_0px_0px_0px_0.5px,_rgb(76,_81,_85)_0px_2px_1px_-1px,_rgb(76,_81,_85)_0px_1px_0px_0px]';

export const codeBlockClassName = 'my-4 rounded-lg bg-muted';
export const codeBlockPreClassName =
  'overflow-x-auto px-4 pb-4 pt-1 font-mono leading-relaxed [tab-size:2] print:break-inside-avoid';
export const codeBlockPreStyle = { fontSize: 'var(--text-sm)' } as const;
export const codeBlockCodeClassName = 'block';
export const codeLineClassName = 'min-h-[1.5em]';

export const dateLayoutClassName = 'w-fit';
export const dateClassName =
  'rounded-sm bg-muted px-1 text-muted-foreground';
export const linkClassName =
  'font-medium text-primary underline decoration-primary underline-offset-4';

export const listClassName = 'relative m-0 p-0';
export const todoListItemClassName = 'flex list-none items-start gap-2';
export const todoListCheckedClassName =
  'text-muted-foreground line-through';
export const todoListCheckboxWrapperClassName = 'mt-1 shrink-0';
export const todoListCheckboxClassName = 'size-4';
export const todoListContentClassName = 'flex-1';

export const tableElementClassName = 'overflow-x-auto pb-5 pt-2';
export const tableWrapperClassName = 'relative';
export const tableClassName = 'mr-0 table h-px border-collapse';
export const tableBodyClassName = 'min-w-full';
export const tableCellClassName =
  'relative h-full overflow-visible border-none bg-background p-0';
export const tableHeaderCellClassName = 'text-left *:m-0';
export const tableCellContentClassName =
  'relative z-20 box-border h-full px-3 py-2';

export const mediaImageElementClassName = 'py-2.5';
export const mediaImageFigureClassName = 'relative m-0';
export const mediaImageLayoutClassName = 'block w-full max-w-full';
export const mediaImageClassName = 'object-cover px-0 rounded-sm';
export const mediaFileElementClassName = 'my-px rounded-sm';
export const mediaFileContentClassName = 'flex items-center gap-1 p-1';
export const mediaFileIconClassName = 'size-5';
export const mediaFileCaptionClassName = 'text-left';

// The split keeps the editor-only cursor class in its original position while
// allowing static and interactive equation renderers to share presentation.
export const equationBlockLayoutClassName = 'group flex';
export const equationBlockPresentationClassName =
  'select-none items-center justify-center rounded-sm';
export const equationBlockEmptyClassName = 'bg-muted p-3 pr-9';
export const equationBlockFilledClassName = 'px-2 py-1';
export const equationEmptyClassName =
  'flex h-7 w-full items-center gap-2 whitespace-nowrap text-muted-foreground text-sm';
export const equationEmptyIconClassName =
  'size-6 text-muted-foreground/80';
export const inlineEquationContentClassName =
  'after:-top-0.5 after:-left-1 after:absolute after:inset-0 after:z-1 after:h-[calc(100%)+4px] after:w-[calc(100%+8px)] after:rounded-sm after:content-[""]';
export const equationValueClassName = 'font-mono leading-none';
export const equationDocxEmptyStyle = {
  color: '#888',
  fontStyle: 'italic',
} as const;
export const equationDocxBlockStyle = {
  fontFamily: 'Cambria Math, Consolas, monospace',
  fontSize: '12pt',
  margin: '8pt 0',
  textAlign: 'center',
} as const;
export const equationDocxInlineStyle = {
  fontFamily: 'Cambria Math, Consolas, monospace',
} as const;
