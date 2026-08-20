"use client";

import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";

interface Props {
  name: string;
  /** The type's human label, shown as a badge. */
  typeLabel: string;
  /** The type's icon, already coloured by the caller. */
  icon: ReactNode;
  description?: string | null;
  /** Who contributed it; null once that account is gone. */
  addedByName?: string | null;
  /** Extra badges beside the type — years for an author, a world for a work. */
  meta?: ReactNode;
  /** Only the contributor may remove their own entry. */
  onDelete?: () => void;
  /**
   * Tints the row. Work locations use it to mark a fictional place, so an
   * invented setting is not mistaken for somewhere you could visit.
   */
  highlighted?: boolean;
}

/**
 * One crowdsourced location.
 *
 * Shared between the author and work sections, which rendered the same row
 * twice with different metadata in the middle. `meta` is that difference: an
 * author location carries a year range, a work location a fictional world.
 */
export default function LocationRow({
  name,
  typeLabel,
  icon,
  description,
  addedByName,
  meta,
  onDelete,
  highlighted = false,
}: Props) {
  return (
    <div
      className={`flex items-start gap-3 rounded-lg p-3 ${
        highlighted ? "bg-purple-500/10" : "bg-[var(--border-light)]"
      }`}
    >
      <div className="mt-0.5">{icon}</div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-[var(--foreground)]">{name}</span>
          <span className="rounded-full bg-[#D4A017]/10 px-2 py-0.5 text-xs text-[#D4A017]">
            {typeLabel}
          </span>
          {meta}
        </div>

        {description && (
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
            {description}
          </p>
        )}

        <p className="mt-1 text-xs text-[var(--foreground-secondary)]">
          Added by {addedByName ?? "a former member"}
        </p>
      </div>

      {onDelete && (
        <button
          onClick={onDelete}
          className="p-1 text-[var(--foreground-secondary)] hover:text-red-500"
          title="Remove location"
          aria-label={`Remove location ${name}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
