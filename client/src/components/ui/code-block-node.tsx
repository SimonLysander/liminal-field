'use client';

import * as React from 'react';

import { formatCodeBlock, isLangSupported } from '@platejs/code-block';
import { BracesIcon, Check } from 'lucide-react';
import { type TCodeBlockElement, type TCodeSyntaxLeaf, NodeApi } from 'platejs';
import {
  type PlateElementProps,
  type PlateLeafProps,
  PlateElement,
  PlateLeaf,
} from 'platejs/react';
import { useEditorRef, useElement, useReadOnly } from 'platejs/react';

import {
  codeBlockClassName,
  codeBlockCodeClassName,
  codeBlockPreClassName,
  codeBlockPreStyle,
  codeLineClassName,
} from '@/components/shared/document-static/document-node-styles';
import { CodeCopyButton } from '@/components/shared/CodeCopyButton';
import { codeLanguages, getCodeLanguageLabel } from '@/components/shared/code-languages';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export function CodeBlockElement(props: PlateElementProps<TCodeBlockElement>) {
  const { editor, element } = props;
  const readOnly = useReadOnly();

  return (
    <PlateElement {...props}>
      <div className={codeBlockClassName}>
        {/* 工具栏独立行，避免与代码第一行重叠 */}
        <div
          className="flex items-center justify-end gap-0.5 border-b px-2 py-1"
          style={{ borderColor: 'color-mix(in srgb, var(--ink) 6%, transparent)' }}
          contentEditable={false}
        >
          {!readOnly && isLangSupported(element.lang) && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-xs"
              onClick={() => formatCodeBlock(editor, { element })}
              title="格式化代码"
            >
              <BracesIcon className="!size-3.5 text-muted-foreground" />
            </Button>
          )}

          <CodeBlockCombobox />

          <CodeCopyButton
            copyAriaLabel="复制"
            copyTitle="复制全部代码"
            size="icon"
            variant="ghost"
            className="size-6 gap-1 text-muted-foreground text-xs"
            value={() =>
              (element.children as TCodeBlockElement['children'])
                .map((line) => NodeApi.string(line))
                .join('\n')
            }
          />
        </div>

        <pre className={codeBlockPreClassName} style={codeBlockPreStyle}>
          <code className={codeBlockCodeClassName}>{props.children}</code>
        </pre>
      </div>
    </PlateElement>
  );
}

function CodeBlockCombobox() {
  const [open, setOpen] = React.useState(false);
  const readOnly = useReadOnly();
  const editor = useEditorRef();
  const element = useElement<TCodeBlockElement>();
  const value = element.lang || 'plaintext';
  const [searchValue, setSearchValue] = React.useState('');

  const items = React.useMemo(
    () =>
      codeLanguages.filter(
        (language) =>
          !searchValue ||
          language.label.toLowerCase().includes(searchValue.toLowerCase())
      ),
    [searchValue]
  );

  if (readOnly) {
    // read-only 模式只显示语言标签，样式与编辑器的 Button 对齐
    const label = getCodeLanguageLabel(value);
    return label ? (
      <span className="flex h-6 select-none items-center gap-1 px-2 text-muted-foreground text-xs">{label}</span>
    ) : null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 select-none justify-between gap-1 px-2 text-muted-foreground text-xs"
          aria-expanded={open}
          role="combobox"
        >
          {codeLanguages.find((language) => language.value === value)?.label ??
            'Plain Text'}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[200px] p-0"
        onCloseAutoFocus={() => setSearchValue('')}
      >
        <Command shouldFilter={false}>
          <CommandInput
            className="h-9"
            value={searchValue}
            onValueChange={(value) => setSearchValue(value)}
            placeholder="搜索语言..."
          />
          <CommandEmpty>没有匹配的语言</CommandEmpty>

          <CommandList className="h-[344px] overflow-y-auto">
            <CommandGroup>
              {items.map((language) => (
                <CommandItem
                  key={language.label}
                  className="cursor-pointer"
                  value={language.value}
                  onSelect={(value) => {
                    editor.tf.setNodes<TCodeBlockElement>(
                      { lang: value },
                      { at: element }
                    );
                    setSearchValue(value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      value === language.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {language.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CodeLineElement(props: PlateElementProps) {
  return <PlateElement className={codeLineClassName} {...props} />;
}

export function CodeSyntaxLeaf(props: PlateLeafProps<TCodeSyntaxLeaf>) {
  const tokenClassName = props.leaf.className as string;

  return <PlateLeaf className={tokenClassName} {...props} />;
}
