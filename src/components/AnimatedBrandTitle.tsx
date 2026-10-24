import React from 'react';

interface AnimatedBrandTitleProps {
  className?: string;
  sizeClass?: string;
}

export const AnimatedBrandTitle: React.FC<AnimatedBrandTitleProps> = ({
  className = '',
  sizeClass = 'text-xl',
}) => {
  return (
    <span
      className={`font-serif font-semibold tracking-tight text-fg select-none inline-block ${sizeClass} ${className}`}
    >
      QUEERSPACE
    </span>
  );
};
