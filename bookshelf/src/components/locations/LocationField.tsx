"use client";

import type { ReactNode } from "react";

/**
 * A labelled field in a location form.
 *
 * The input styling was repeated for every field across both sections. Kept as
 * a wrapper rather than a wrapping input so a field can hold a select, a
 * checkbox pair, or two inputs side by side — which is what the two sections
 * actually need.
 */
export default function LocationField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-sm font-medium text-[var(--foreground-secondary)]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/** The shared input styling, so a new field cannot drift from the others. */
export const locationInputClass =
  "w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-[var(--foreground)] focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#D4A017]";
