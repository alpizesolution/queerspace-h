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
      className={`font-serif font-bold tracking-tight text-[#fcf7fa] select-none inline-block ${sizeClass} ${className}`}
    >
      QUEERSPACE
    </span>
  );
};
