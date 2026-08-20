"use client";

import type { ReactNode } from "react";
import { Globe, Plus, X } from "lucide-react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface Props {
  /** "Author Locations" or "Locations in this Book". */
  title: string;
  /** Signed-out visitors can read but not contribute. */
  canContribute: boolean;
  formOpen: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  /** The add form's fields and submit button — every field differs by entity. */
  form: ReactNode;
  onSubmit: (event: React.FormEvent) => void;
  /** The rendered rows, or nothing for the empty state. */
  children: ReactNode;
  isEmpty: boolean;
  /** Non-null while a removal is awaiting confirmation. */
  pendingDeleteName: string | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}

/**
 * The shell both crowdsourced-location sections share.
 *
 * AuthorLocationsSection and WorkLocationsSection were 328 and 346 lines with
 * 43% of the smaller one sitting in identical blocks of six lines or more: this
 * card, its header and add button, the form wrapper, the empty state and the
 * delete confirmation. The data layer was already shared through
 * `useCrowdsourcedLocations`; this is the presentation half.
 *
 * What is left outside is genuinely different rather than merely unfactored —
 * an author location has years and a work location has a fictional world, and
 * the type lists have nothing in common. Those arrive through `form` and the
 * rows through `children`, which keeps this a shell rather than a component
 * trying to be both things at once.
 */
export default function LocationsPanel({
  title,
  canContribute,
  formOpen,
  onOpenForm,
  onCloseForm,
  form,
  onSubmit,
  children,
  isEmpty,
  pendingDeleteName,
  onConfirmDelete,
  onCancelDelete,
}: Props) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--foreground)]">
          <Globe className="h-5 w-5 text-[#D4A017]" aria-hidden="true" />
          {title}
        </h3>
        {canContribute && !formOpen && (
          <button
            onClick={onOpenForm}
            className="flex items-center gap-1 text-sm font-medium text-[#D4A017] hover:text-[#B8860B]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Location
          </button>
        )}
      </div>

      {formOpen && (
        <form
          onSubmit={onSubmit}
          className="mb-4 rounded-lg bg-[var(--border-light)] p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h4 className="font-medium text-[var(--foreground)]">Add a Location</h4>
            <button
              type="button"
              onClick={onCloseForm}
              aria-label="Cancel adding a location"
              className="text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-3">{form}</div>
        </form>
      )}

      {isEmpty ? (
        <div className="py-6 text-center text-[var(--foreground-secondary)]">
          <Globe
            className="mx-auto mb-2 h-8 w-8 text-[var(--foreground-secondary)]"
            aria-hidden="true"
          />
          <p className="text-sm">No locations added yet</p>
          {canContribute && !formOpen && (
            <button
              onClick={onOpenForm}
              className="mt-2 text-sm font-medium text-[#D4A017] hover:text-[#B8860B]"
            >
              Be the first to add one
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">{children}</div>
      )}

      <ConfirmDialog
        open={pendingDeleteName !== null}
        title="Remove this location?"
        message={
          pendingDeleteName
            ? `"${pendingDeleteName}" will be removed from this page.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </div>
  );
}

/** Placeholder while the list loads, so the card does not jump into place. */
export function LocationsPanelSkeleton() {
  return (
    <div className="h-48 animate-pulse rounded-lg bg-[var(--border-light)] p-4" />
  );
}
