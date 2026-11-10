'use client';

import React from 'react';
import { Button } from './Button';
import { Card } from './Card';
import { cx } from './cx';

interface EmptyStateBase {
  /** Optional serif headline. */
  title?: string;
  /** Optional supporting line. */
  message?: string;
  className?: string;
  /** Already inside a container (the Library photo grid, #1175): no card of its own. */
  inset?: boolean;
}

/**
 * Nothing exists yet: say what goes here and offer the create action. People's
 * "No people yet" state is the model (#696).
 */
interface EmptyStateEmptyProps extends EmptyStateBase {
  variant: 'empty';
  /** The create action, usually a `<Button variant="outline" size="sm">`. Omit for viewers. */
  action?: React.ReactNode;
}

/**
 * Records exist but the current search or filters hide them all: say what is
 * filtered and offer the one "Clear filters" reset (#696).
 */
interface EmptyStateFilteredProps extends EmptyStateBase {
  variant: 'filtered';
  /** Already translated reset label, normally common.clear_filters. */
  clearLabel: string;
  /** Resets every filter and the search the empty result depends on. */
  onClear: () => void;
}

export type EmptyStateProps = EmptyStateEmptyProps | EmptyStateFilteredProps;

/**
 * Centered empty / no-results card. Every list routes both of its "nothing to
 * show" cases through here, so an empty tree never claims filters are set and a
 * filtered list always offers the same reset (#175, #696).
 */
export function EmptyState(props: EmptyStateProps) {
  const { title, message, className = '', inset = false } = props;
  const action = props.variant === 'filtered' ? (
    <Button type="button" variant="outline" size="sm" onClick={props.onClear}>{props.clearLabel}</Button>
  ) : props.action;
  const body = (
    <>
      {title && <div className="serif text-lg font-semibold">{title}</div>}
      {message && <p className={cx('text-text-muted text-sm', title && 'mt-1.5')}>{message}</p>}
      {action && <div className="mt-3.5">{action}</div>}
    </>
  );
  if (inset) return <div data-variant={props.variant} className={cx('px-4 py-12 text-center', className)}>{body}</div>;
  return (
    <Card pad={false} data-variant={props.variant} className={cx('px-4 py-12 text-center', className)}>
      {body}
    </Card>
  );
}
