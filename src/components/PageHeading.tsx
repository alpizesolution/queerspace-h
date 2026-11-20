import React from 'react';

/** The compact page heading shared by ATLAS and Echoes: the name and its tagline on one line, wrapping naturally on narrow screens. */
export const PageHeading: React.FC<{ title: string; tagline: string }> = ({ title, tagline }) => (
  <h1 className="min-w-0 leading-tight">
    <span className="text-[length:calc(22px_*_var(--fs,1))] font-semibold tracking-tight text-fg sm:text-[length:calc(26px_*_var(--fs,1))]">{title}</span>
    <span className="ml-2 font-serif text-[length:calc(13px_*_var(--fs,1))] font-normal italic text-lavender sm:text-[length:calc(14px_*_var(--fs,1))]">{tagline}</span>
  </h1>
);
