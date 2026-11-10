import React from 'react';
import { initialsFromName } from '@/lib/utils/initials';
import { avatarClass } from '@/lib/utils/avatar';

export interface AvatarProps {
  name?: string;
  /** Person Sex code ('M' / 'F' / 'X' / null) — drives the disc gradient. */
  sex?: string | null;
  src?: string | null;
  size?: number;
  square?: boolean;
  className?: string;
}

export function Avatar({ name = '', sex = null, src = null, size = 48, square = false, className = '' }: AvatarProps) {
  const grad = avatarClass(sex);
  const radiusClass = square ? 'rounded-lg' : 'rounded-full';
  // size is a caller-provided dynamic dimension, not a design constant → inline is correct.
  return (
    <div
      className={`flex items-center justify-center shrink-0 overflow-hidden shadow-md ${src ? 'bg-card-alt' : grad} ${radiusClass} ${className}`.trim()}
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-white font-semibold leading-none" style={{ fontSize: Math.round(size * 0.36) }}>
          {initialsFromName(name)}
        </span>
      )}
    </div>
  );
}
