'use client';
import React from 'react';
import { cx } from './cx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  accent?: boolean;       // neutral left rule (most-recent signal)
  interactive?: boolean;  // hover lift + neutral strong border
  pad?: boolean;          // default 16px padding
  ref?: React.Ref<HTMLDivElement>;
}

const BASE = 'bg-card border border-border rounded-card';
const STATIC = 'shadow-card';
// Hover/focus lift, warm shadow and neutral edge live in `.card-interactive`
// (globals.css), which also covers focus on a wrapping link and reduced motion.
const INTERACTIVE = 'card-interactive';

export function Card({ accent = false, interactive = false, pad = true, className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        BASE,
        interactive ? INTERACTIVE : STATIC,
        pad && 'p-4',
        accent && 'border-l-[3px] border-l-text-secondary',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
