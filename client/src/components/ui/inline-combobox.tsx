/**
 * InlineCombobox — Plate UI 行内 combobox 组件。
 *
 * 基于 Ariakit Combobox + @platejs/combobox，为 SlashInputElement 等行内触发菜单
 * 提供自动补全弹窗。来源：Plate 官方 registry，适配本项目设计系统。
 */
'use client';

import * as React from 'react';

import type { TElement } from 'platejs';

import {
  type ComboboxItemProps,
  Combobox,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxPopover,
  ComboboxProvider,
  ComboboxRow,
  Portal,
  useComboboxContext,
  useComboboxStore,
} from '@ariakit/react';
import { filterWords } from '@platejs/combobox';
import {
  type UseComboboxInputResult,
  useComboboxInput,
  useHTMLInputCursorState,
} from '@platejs/combobox/react';
import { cva } from 'class-variance-authority';
import { useComposedRef, useEditorRef } from 'platejs/react';

import { cn } from '@/lib/utils';

type FilterFn = (
  item: { value: string; group?: string; keywords?: string[]; label?: string },
  search: string
) => boolean;

type NavigateNextItem = {
  group?: string;
  label?: string;
  value: string;
};

type InlineComboboxContextValue = {
  filter: FilterFn | false;
  inputProps: UseComboboxInputResult['props'];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onNavigateNext?: (item: NavigateNextItem) => boolean;
  removeInput: UseComboboxInputResult['removeInput'];
  showTrigger: boolean;
  trigger: string;
  setHasEmpty: (hasEmpty: boolean) => void;
};

const InlineComboboxContext = React.createContext<InlineComboboxContextValue>(
  null as unknown as InlineComboboxContextValue
);

const defaultFilter: FilterFn = (
  { group, keywords = [], label, value },
  search
) => {
  const uniqueTerms = new Set(
    [value, ...keywords, group, label].filter(Boolean)
  );

  return Array.from(uniqueTerms).some((keyword) =>
    filterWords(keyword!, search)
  );
};

type InlineComboboxProps = {
  children: React.ReactNode;
  element: TElement;
  trigger: string;
  filter?: FilterFn | false;
  hideWhenNoValue?: boolean;
  onNavigateNext?: (item: NavigateNextItem) => boolean;
  showTrigger?: boolean;
  value?: string;
  setValue?: (value: string) => void;
};

const InlineCombobox = ({
  children,
  element,
  filter = defaultFilter,
  hideWhenNoValue = false,
  onNavigateNext,
  setValue: setValueProp,
  showTrigger = true,
  trigger,
  value: valueProp,
}: InlineComboboxProps) => {
  const editor = useEditorRef();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const cursorState = useHTMLInputCursorState(inputRef);

  const [valueState, setValueState] = React.useState('');
  const hasValueProp = valueProp !== undefined;
  const value = hasValueProp ? valueProp : valueState;

  const setValue = React.useCallback(
    (newValue: string) => {
      setValueProp?.(newValue);

      if (!hasValueProp) {
        setValueState(newValue);
      }
    },
    [setValueProp, hasValueProp]
  );

  /**
   * 记录 input 元素前一个 point，当 combobox 因选区变化关闭时，
   * 把已输入的文本 insertText 回文档。
   */
  const insertPointRef = React.useRef<ReturnType<
    typeof editor.api.pointRef
  > | null>(null);

  React.useEffect(() => {
    insertPointRef.current?.unref();
    insertPointRef.current = null;

    const path = editor.api.findPath(element);
    if (!path) return;

    const point = editor.api.before(path);
    if (!point) return;

    const pointRef = editor.api.pointRef(point);
    insertPointRef.current = pointRef;

    return () => {
      if (insertPointRef.current === pointRef) {
        insertPointRef.current = null;
      }
      pointRef.unref();
    };
  }, [editor, element]);

  const { props: inputProps, removeInput } = useComboboxInput({
    cancelInputOnBlur: true,
    cursorState,
    autoFocus: true,
    ref: inputRef,
    onCancelInput: (cause) => {
      if (cause !== 'backspace') {
        editor.tf.insertText(trigger + value, {
          at: insertPointRef.current?.current ?? undefined,
        });
      }
      if (cause === 'arrowLeft' || cause === 'arrowRight') {
        editor.tf.move({
          distance: 1,
          reverse: cause === 'arrowLeft',
        });
      }
    },
  });

  const [hasEmpty, setHasEmpty] = React.useState(false);

  const contextValue: InlineComboboxContextValue = React.useMemo(
    () => ({
      filter,
      inputProps,
      inputRef,
      onNavigateNext,
      removeInput,
      setHasEmpty,
      showTrigger,
      trigger,
    }),
    [trigger, showTrigger, filter, inputRef, inputProps, onNavigateNext, removeInput, setHasEmpty]
  );

  const store = useComboboxStore({
    setValue: (newValue) => React.startTransition(() => setValue(newValue)),
  });

  const items = store.useState('items');

  /* 无 activeId 时自动选中第一项 */
  React.useEffect(() => {
    if (!store.getState().activeId) {
      store.setActiveId(store.first());
    }
  }, [items, store]);

  return (
    <span contentEditable={false}>
      <ComboboxProvider
        open={
          (items.length > 0 || hasEmpty) &&
          (!hideWhenNoValue || value.length > 0)
        }
        store={store}
      >
        <InlineComboboxContext.Provider value={contextValue}>
          {children}
        </InlineComboboxContext.Provider>
      </ComboboxProvider>
    </span>
  );
};

const InlineComboboxInput = ({
  className,
  onKeyDown,
  ref: propRef,
  ...props
}: React.HTMLAttributes<HTMLInputElement> & {
  ref?: React.RefObject<HTMLInputElement | null>;
}) => {
  const {
    inputProps,
    inputRef: contextRef,
    onNavigateNext,
    removeInput,
    showTrigger,
    trigger,
  } = React.useContext(InlineComboboxContext);

  const store = useComboboxContext()!;
  const value = store.useState('value');

  const ref = useComposedRef(propRef, contextRef);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'ArrowRight' && onNavigateNext) {
        const activeId = store.getState().activeId;
        const activeElement = activeId ? document.getElementById(activeId) : null;
        const value = activeElement?.getAttribute('data-inline-combobox-value');

        if (value) {
          const handled = onNavigateNext({
            group: activeElement?.getAttribute('data-inline-combobox-group') ?? undefined,
            label: activeElement?.getAttribute('data-inline-combobox-label') ?? undefined,
            value,
          });

          if (handled) {
            event.preventDefault();
            event.stopPropagation();
            removeInput(false);
            return;
          }
        }
      }

      inputProps.onKeyDown(event);
      onKeyDown?.(event);
    },
    [inputProps, onKeyDown, onNavigateNext, removeInput, store]
  );

  return (
    <>
      {showTrigger && trigger}

      <span className="relative min-h-[1lh]">
        {/* 隐藏 span 撑开宽度，实现输入框自动伸缩 */}
        <span
          className="invisible overflow-hidden text-nowrap"
          aria-hidden="true"
        >
          {value || '\u200B'}
        </span>

        <Combobox
          ref={ref}
          data-inline-combobox-input="true"
          className={cn(
            'absolute top-0 left-0 size-full bg-transparent outline-none',
            className
          )}
          value={value}
          autoSelect
          {...inputProps}
          {...props}
          onKeyDown={handleKeyDown}
        />
      </span>
    </>
  );
};

InlineComboboxInput.displayName = 'InlineComboboxInput';

const InlineComboboxContent: typeof ComboboxPopover = ({
  className,
  ...props
}) => {
  const store = useComboboxContext();

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!store) return;

    const state = store.getState();
    const { items, activeId } = state;

    if (!items.length) return;

    const currentIndex = items.findIndex((item) => item.id === activeId);

    /* 上下箭头循环导航：到顶回底，到底回顶 */
    if (event.key === 'ArrowUp' && currentIndex <= 0) {
      event.preventDefault();
      store.setActiveId(store.last());
    } else if (event.key === 'ArrowDown' && currentIndex >= items.length - 1) {
      event.preventDefault();
      store.setActiveId(store.first());
    }
  }

  return (
    <Portal>
      <ComboboxPopover
        className={cn(
          'z-500 max-h-[288px] w-[300px] overflow-y-auto rounded-md bg-popover shadow-md',
          className
        )}
        onKeyDownCapture={handleKeyDown}
        {...props}
      />
    </Portal>
  );
};

const comboboxItemVariants = cva(
  'relative mx-1 flex h-[28px] select-none items-center rounded-sm px-2 text-foreground text-sm outline-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    defaultVariants: {
      interactive: true,
    },
    variants: {
      interactive: {
        false: '',
        true: 'cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground data-[active-item=true]:bg-accent data-[active-item=true]:text-accent-foreground',
      },
    },
  }
);

const InlineComboboxItem = ({
  className,
  closeOnSelect = true,
  focusEditor = true,
  group,
  keywords,
  label,
  onClick,
  ...props
}: {
  closeOnSelect?: boolean;
  focusEditor?: boolean;
  group?: string;
  keywords?: string[];
  label?: string;
} & ComboboxItemProps &
  Required<Pick<ComboboxItemProps, 'value'>>) => {
  const { value } = props;

  const { filter, removeInput } = React.useContext(InlineComboboxContext);

  const store = useComboboxContext()!;

  const search = filter && store.useState('value');

  const visible = React.useMemo(
    () =>
      !filter || filter({ group, keywords, label, value }, search as string),
    [filter, group, keywords, label, value, search]
  );

  if (!visible) return null;

  return (
    <ComboboxItem
      className={cn(comboboxItemVariants(), className)}
      data-inline-combobox-group={group}
      data-inline-combobox-label={label}
      data-inline-combobox-value={value}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={(event) => {
        if (closeOnSelect) {
          removeInput(focusEditor);
        }
        onClick?.(event);
      }}
      {...props}
    />
  );
};

const InlineComboboxEmpty = ({
  children,
  className,
}: React.HTMLAttributes<HTMLDivElement>) => {
  const { setHasEmpty } = React.useContext(InlineComboboxContext);
  const store = useComboboxContext()!;
  const items = store.useState('items');

  React.useEffect(() => {
    setHasEmpty(true);

    return () => {
      setHasEmpty(false);
    };
  }, [setHasEmpty]);

  if (items.length > 0) return null;

  return (
    <div
      className={cn(comboboxItemVariants({ interactive: false }), className)}
    >
      {children}
    </div>
  );
};

const InlineComboboxRow = ComboboxRow;

function InlineComboboxGroup({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxGroup>) {
  return (
    <ComboboxGroup
      {...props}
      className={cn(
        'hidden not-last:border-b py-1.5 [&:has([role=option])]:block',
        className
      )}
    />
  );
}

function InlineComboboxGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxGroupLabel>) {
  return (
    <ComboboxGroupLabel
      {...props}
      className={cn(
        'mt-1.5 mb-2 px-3 font-medium text-muted-foreground text-xs',
        className
      )}
    />
  );
}

export {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
  InlineComboboxRow,
};
