'use client';

import React from 'react';

import type { TListElement } from 'platejs';

import { isOrderedList } from '@platejs/list';
import {
  useTodoListElement,
  useTodoListElementState,
} from '@platejs/list/react';
import {
  type PlateElementProps,
  type RenderNodeWrapper,
  useReadOnly,
} from 'platejs/react';

import {
  listClassName,
  todoListCheckboxClassName,
  todoListCheckboxWrapperClassName,
  todoListCheckedClassName,
  todoListContentClassName,
  todoListItemClassName,
} from '@/components/shared/document-static/document-node-styles';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

const config: Record<
  string,
  {
    Li: React.FC<PlateElementProps>;
    Marker?: React.FC<PlateElementProps>;
  }
> = {
  todo: {
    Li: TodoLi,
  },
};

export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return;

  return (props) => <List {...props} />;
};

function List(props: PlateElementProps) {
  const { listStart, listStyleType } = props.element as TListElement;
  const { Li, Marker } = config[listStyleType] ?? {};
  const List = isOrderedList(props.element) ? 'ol' : 'ul';

  return (
    <List
      className={listClassName}
      style={{ listStyleType }}
      start={listStart}
    >
      {Marker && <Marker {...props} />}
      {Li ? <Li {...props} /> : <li>{props.children}</li>}
    </List>
  );
}

function TodoLi(props: PlateElementProps) {
  const state = useTodoListElementState({ element: props.element });
  const { checkboxProps } = useTodoListElement(state);
  const readOnly = useReadOnly();
  const checked = props.element.checked as boolean;

  return (
    <li className={cn(todoListItemClassName, checked && todoListCheckedClassName)}>
      <span className={todoListCheckboxWrapperClassName} contentEditable={false}>
        <Checkbox
          className={cn(todoListCheckboxClassName, readOnly && 'pointer-events-none')}
          {...checkboxProps}
        />
      </span>
      <span className={todoListContentClassName}>{props.children}</span>
    </li>
  );
}
