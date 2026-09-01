"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { ShelfWithItems } from "@/server/shelves";
import ShelfSection from "./ShelfSection";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/providers/ToastProvider";

/**
 * Creating and deleting custom shelves.
 *
 * `POST /api/shelves` and `DELETE /api/shelves/[shelfId]` have existed, worked
 * and been covered by authorization tests since M1, and nothing ever called
 * them — while README.md advertised "unlimited custom shelves" and this page
 * rendered a "Custom Shelves" heading over a list that could never be non-empty.
 * The audit recorded it as a blocker rather than deleting routes a documented
 * feature depends on.
 */
export default function CustomShelves({
  shelves,
}: {
  shelves: ShelfWithItems[];
}) {
  const router = useRouter();
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ShelfWithItems | null>(
    null
  );

  async function createShelf(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setCreating(true);
    try {
      const response = await fetch("/api/shelves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast(data.error ?? "Could not create that shelf", "error");
        return;
      }

      setName("");
      setFormOpen(false);
      showToast(`Created “${trimmed}”`, "success");
      router.refresh();
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function deleteShelf(shelf: ShelfWithItems) {
    try {
      const response = await fetch(`/api/shelves/${shelf.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        showToast(data.error ?? "Could not delete that shelf", "error");
        return;
      }

      showToast(`Deleted “${shelf.name}”`, "success");
      router.refresh();
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className="mt-12">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">
          Custom Shelves
        </h2>
        {!formOpen && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-1.5"
          >
            <Plus className="h-4 w-4" />
            New shelf
          </Button>
        )}
      </div>

      {formOpen && (
        <form onSubmit={createShelf} className="mb-8 flex items-end gap-3">
          <div className="flex-1 max-w-sm">
            <Input
              label="Shelf name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Summer reading"
              maxLength={200}
              autoFocus
              required
            />
          </div>
          <Button type="submit" isLoading={creating} size="sm">
            Create
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setFormOpen(false);
              setName("");
            }}
          >
            Cancel
          </Button>
        </form>
      )}

      {shelves.length === 0 ? (
        <p className="text-[var(--foreground-secondary)]">
          No custom shelves yet. Make one for a theme, a year, or a project —
          the three built-in shelves stay as they are.
        </p>
      ) : (
        <div className="space-y-8">
          {shelves.map((shelf) => (
            <div key={shelf.id} className="group relative">
              <button
                onClick={() => setPendingDelete(shelf)}
                aria-label={`Delete ${shelf.name}`}
                className="absolute right-0 top-0 rounded-full p-2 text-[var(--foreground-secondary)] opacity-0 transition-opacity hover:bg-[var(--border-light)] hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <ShelfSection shelf={shelf} />
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.name ?? ""}”?`}
        message={
          pendingDelete && pendingDelete.itemCount > 0
            ? `The shelf goes; the ${pendingDelete.itemCount} ${
                pendingDelete.itemCount === 1 ? "book" : "books"
              } on it stay in your library.`
            : "This shelf is empty."
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => pendingDelete && deleteShelf(pendingDelete)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
