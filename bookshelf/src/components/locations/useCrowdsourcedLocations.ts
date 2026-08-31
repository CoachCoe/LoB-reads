"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/providers/ToastProvider";

/**
 * Shared load/add/remove lifecycle for the crowdsourced location sections.
 *
 * `AuthorLocationsSection` and `BookLocationsSection` duplicated this logic
 * verbatim. Their *forms* genuinely differ — one collects years, the other a
 * fictional world — so they stay as separate components; only the part that
 * was actually identical lives here.
 *
 * Failures previously went to the console and nothing else, leaving the user
 * looking at a form that appeared to do nothing. They now surface as toasts.
 */
export interface LocationEndpoint<T> {
  /** e.g. `/api/books/abc123/locations` */
  basePath: string;
  /** Endpoints differ: one returns `{ locations }`, the other a bare array. */
  extractList: (payload: unknown) => T[];
}

export function useCrowdsourcedLocations<T extends { id: string; name: string }>({
  basePath,
  extractList,
}: LocationEndpoint<T>) {
  const [locations, setLocations] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<T | null>(null);
  const { showToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(basePath);
      if (!res.ok) {
        // The two writes below already toast, per this hook's own docstring.
        // The READ did not, so a failed load presented as an authoritative
        // "No locations added yet" — telling the reader there is nothing here
        // when the truth is we could not find out.
        showToast("Could not load locations for this page", "error");
        return;
      }
      setLocations(extractList(await res.json()));
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    } finally {
      setLoading(false);
    }
  }, [basePath, extractList, showToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Returns true when the location was created, so callers can reset a form. */
  const addLocation = useCallback(
    async (body: Record<string, unknown>): Promise<boolean> => {
      if (submitting) return false;

      setSubmitting(true);
      try {
        const res = await fetch(basePath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          await refresh();
          showToast("Location added");
          return true;
        }

        const error = await res.json().catch(() => ({}));
        showToast(error.error || "Failed to add location", "error");
        return false;
      } catch (error) {
        console.error("Failed to add location:", error);
        showToast("Failed to add location", "error");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [basePath, refresh, showToast, submitting]
  );

  const removeLocation = useCallback(
    async (locationId: string) => {
      try {
        const res = await fetch(
          `${basePath}?locationId=${encodeURIComponent(locationId)}`,
          { method: "DELETE" }
        );

        if (res.ok) {
          setLocations((current) => current.filter((l) => l.id !== locationId));
          showToast("Location removed");
        } else {
          const error = await res.json().catch(() => ({}));
          showToast(error.error || "Failed to remove location", "error");
        }
      } catch (error) {
        console.error("Failed to delete location:", error);
        showToast("Failed to remove location", "error");
      } finally {
        setPendingDelete(null);
      }
    },
    [basePath, showToast]
  );

  return {
    locations,
    loading,
    submitting,
    pendingDelete,
    setPendingDelete,
    addLocation,
    removeLocation,
    refresh,
  };
}
