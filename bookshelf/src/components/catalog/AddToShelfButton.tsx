"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { ChevronDown, Check, BookPlus, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";

interface Shelf {
  id: string;
  name: string;
  isDefault: boolean;
}

interface ShelfStatus {
  shelfId: string;
  shelfName: string;
  isDefault: boolean;
}

interface AddToShelfButtonProps {
  workKey: string;
  onAdd?: () => void;
}

/**
 * Put a work on a shelf, or take it off.
 *
 * Written against the pre-M3 `bookId` contract and mounted nowhere: the
 * repoint from app.books to work_key moved the routes and left this behind, so
 * there was no way to shelve a book from the UI at all. Ratings and shelves
 * could only arrive through the Goodreads importer.
 */
export default function AddToShelfButton({
  workKey,
  onAdd,
}: AddToShelfButtonProps) {
  const { data: session } = useSession();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [currentShelves, setCurrentShelves] = useState<ShelfStatus[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loadingShelf, setLoadingShelf] = useState<string | null>(null);

  const fetchShelves = useCallback(async () => {
    try {
      const response = await fetch("/api/shelves");
      if (response.ok) {
        const data = await response.json();
        setShelves(data);
      }
    } catch (error) {
      console.error("Failed to fetch shelves:", error);
    }
  }, []);

  const fetchShelfStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/works/${workKey}/shelves`);
      if (response.ok) {
        setCurrentShelves(await response.json());
      }
    } catch {
      // Not on any shelf yet, which is the common case.
    }
  }, [workKey]);

  useEffect(() => {
    if (session?.user) {
      fetchShelves();
      fetchShelfStatus();
    }
  }, [session, fetchShelves, fetchShelfStatus]);

  const handleAddToShelf = async (shelfId: string) => {
    setLoadingShelf(shelfId);
    try {
      const response = await fetch(`/api/shelves/${shelfId}/works`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workKey }),
      });

      if (response.ok) {
        await fetchShelfStatus();
        onAdd?.();
      }
    } catch (error) {
      console.error("Failed to add to shelf:", error);
    } finally {
      setLoadingShelf(null);
      setIsOpen(false);
    }
  };

  const handleRemoveFromShelf = async (shelfId: string) => {
    setLoadingShelf(shelfId);
    try {
      const response = await fetch(`/api/shelves/${shelfId}/works`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workKey }),
      });

      if (response.ok) {
        await fetchShelfStatus();
      }
    } catch (error) {
      console.error("Failed to remove from shelf:", error);
    } finally {
      setLoadingShelf(null);
    }
  };

  if (!session?.user) {
    return null;
  }

  const defaultShelf = currentShelves.find((s) => s.isDefault);
  const buttonLabel = defaultShelf ? defaultShelf.shelfName : "Add to Shelf";

  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant={defaultShelf ? "secondary" : "primary"}
        className="flex items-center gap-2"
        disabled={loadingShelf !== null}
      >
        {defaultShelf ? (
          <Check className="h-4 w-4" />
        ) : (
          <BookPlus className="h-4 w-4" />
        )}
        {buttonLabel}
        <ChevronDown className="h-4 w-4" />
      </Button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 w-56 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
            {shelves.map((shelf) => {
              const isOnShelf = currentShelves.some((s) => s.shelfId === shelf.id);
              const isLoadingThis = loadingShelf === shelf.id;

              return (
                <button
                  key={shelf.id}
                  onClick={() =>
                    isOnShelf
                      ? handleRemoveFromShelf(shelf.id)
                      : handleAddToShelf(shelf.id)
                  }
                  disabled={isLoadingThis}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between"
                >
                  <span>{shelf.name}</span>
                  {isLoadingThis ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400 dark:text-gray-500" />
                  ) : isOnShelf ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
