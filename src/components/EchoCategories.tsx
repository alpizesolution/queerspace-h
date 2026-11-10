import React from 'react';
import {
  ECHO_GROUPS,
  UNSAID_KINDS,
  groupOfKind,
  kindAllowsReplies,
  kindInfo,
  kindsInGroup,
  type EchoFilter,
  type EchoGroupId,
  type UnsaidKind,
} from '../utils/echoKinds.ts';

/**
 * How Echoes shows its eight categories: a tag on each post, a two-level filter (Release / Connect / Uplift, then the
 * categories inside the group) and the grouped picker in the composer. Release keeps the original looks (Vent in berry,
 * Confession in lavender); Connect and Uplift have their own soft accents (index.css, --echo-connect and --echo-uplift).
 */

/** Card colours per category. Vent and Confession are exactly what they were. */
export function echoCardClass(kind: UnsaidKind): string {
  if (kind === 'vent') return 'border-berry/20 bg-gradient-to-br from-berry/[0.09] via-surface to-surface';
  if (kind === 'confession' || kind === 'unsent') return 'border-lavender/20 bg-gradient-to-br from-lavender/[0.09] via-surface to-surface';
  return `echo-card-tone ${groupOfKind(kind) === 'connect' ? 'echo-tone-connect' : 'echo-tone-uplift'}`;
}

export function echoTagClass(kind: UnsaidKind): string {
  if (kind === 'vent') return '!text-berry';
  if (kind === 'confession' || kind === 'unsent') return '!text-lavender';
  return `echo-tag-tone ${groupOfKind(kind) === 'connect' ? 'echo-tone-connect' : 'echo-tone-uplift'}`;
}

/** The small label above a post: its emoji and category. */
export const EchoKindTag: React.FC<{ kind: UnsaidKind; className?: string }> = ({ kind, className = '' }) => {
  const info = kindInfo(kind);
  return (
    <span className={`tag ${echoTagClass(kind)} ${className}`}>
      <span aria-hidden="true">{info.emoji}</span> {info.label}
    </span>
  );
};

const CHIP_ON = '!bg-fg !text-ink !border-fg';

const isGroup = (filter: EchoFilter, id: EchoGroupId): boolean => filter !== 'all' && 'group' in filter && filter.group === id;
const isKind = (filter: EchoFilter, id: string): boolean => filter !== 'all' && 'kind' in filter && filter.kind === id;

/** The group a filter is inside (for showing that group's categories), or null for "All". */
export function filterGroup(filter: EchoFilter): EchoGroupId | null {
  if (filter === 'all') return null;
  return 'group' in filter ? filter.group : groupOfKind(filter.kind);
}

/**
 * The feed filter. One row of "All, Release, Connect, Uplift"; choosing a group opens a second, smaller row with that group's
 * categories, so there are never nine chips on screen at once.
 */
export const EchoFilterBar: React.FC<{ filter: EchoFilter; onChange: (next: EchoFilter) => void }> = ({ filter, onChange }) => {
  const open = filterGroup(filter);
  const group = ECHO_GROUPS.find((g) => g.id === open);
  return (
    <div className="mb-4 space-y-2">
      <div role="tablist" aria-label="Filter echoes" className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto scrollbar-none pb-0.5">
        <button role="tab" aria-selected={filter === 'all'} onClick={() => onChange('all')} className={`chip shrink-0 ${filter === 'all' ? CHIP_ON : ''}`}>
          All
        </button>
        {ECHO_GROUPS.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={open === g.id}
            onClick={() => onChange({ group: g.id })}
            className={`chip shrink-0 ${open === g.id ? CHIP_ON : ''}`}
          >
            <span aria-hidden="true">{g.emoji}</span> {g.label}
          </button>
        ))}
      </div>
      {group && (
        <div role="tablist" aria-label={`${group.label} categories`} className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5 anim-fade">
          <button
            role="tab"
            aria-selected={isGroup(filter, group.id)}
            onClick={() => onChange({ group: group.id })}
            className={`chip chip-sm shrink-0 ${isGroup(filter, group.id) ? CHIP_ON : ''}`}
          >
            All {group.label}
          </button>
          {kindsInGroup(group.id).map((k) => (
            <button
              key={k.id}
              role="tab"
              aria-selected={isKind(filter, k.id)}
              onClick={() => onChange({ kind: k.id as UnsaidKind })}
              className={`chip chip-sm shrink-0 ${isKind(filter, k.id) ? CHIP_ON : ''}`}
            >
              <span aria-hidden="true">{k.emoji}</span> {k.plural}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/** What an empty feed says for the current filter. */
export function emptyEchoTitle(filter: EchoFilter): string {
  if (filter === 'all') return "It's quiet here";
  if ('group' in filter) return `Nothing in ${ECHO_GROUPS.find((g) => g.id === filter.group)!.label} yet`;
  return `No ${kindInfo(filter.kind).plural.toLowerCase()} yet`;
}

/**
 * The composer's category picker: three small groups, each with its categories, then one line that says what the chosen
 * category is for and whether others can reply to it.
 */
export const EchoKindPicker: React.FC<{ value: UnsaidKind; onChange: (kind: UnsaidKind) => void }> = ({ value, onChange }) => {
  const chosen = kindInfo(value);
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Post type">
      {ECHO_GROUPS.map((g) => (
        <div key={g.id}>
          <p className="mb-1 text-[length:calc(11px_*_var(--fs,1))] font-semibold uppercase tracking-[0.12em] text-subtle">
            <span aria-hidden="true">{g.emoji}</span> {g.label}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {kindsInGroup(g.id).map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={value === k.id}
                onClick={() => onChange(k.id as UnsaidKind)}
                className={`chip chip-sm ${value === k.id ? CHIP_ON : ''}`}
              >
                <span aria-hidden="true">{k.emoji}</span> {k.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[length:calc(12px_*_var(--fs,1))] leading-snug text-muted" aria-live="polite">
        {chosen.hint}{' '}
        <span className="text-subtle">{kindAllowsReplies(value) ? 'Replies are on.' : 'Reactions only: no replies.'}</span>
      </p>
    </div>
  );
};

/** For tests and callers that need the list in display order. */
export const ECHO_KIND_COUNT = UNSAID_KINDS.length;
