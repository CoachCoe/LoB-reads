"use client";

import { useState, useEffect } from "react";
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
  bookId: string;
  onAdd?: () => void;
}

export default function AddToShelfButton({ bookId, onAdd }: AddToShelfButtonProps) {
  const { data: session } = useSession();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [currentShelves, setCurrentShelves] = useState<ShelfStatus[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingShelf, setLoadingShelf] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user) {
      fetchShelves();
      fetchBookStatus();
    }
  }, [session, bookId]);

  const fetchShelves = async () => {
    try {
      const response = await fetch("/api/shelves");
      if (response.ok) {
        const data = await response.json();
        setShelves(data);
      }
    } catch (error) {
      console.error("Failed to fetch shelves:", error);
    }
  };

  const fetchBookStatus = async () => {
    try {
      const response = await fetch(`/api/books/${bookId}/shelves`);
      if (response.ok) {
        const data = await response.json();
        setCurrentShelves(data);
      }
    } catch {
      // Book might not be on any shelf yet
    }
  };

  const handleAddToShelf = async (shelfId: string) => {
    setLoadingShelf(shelfId);
    try {
      const response = await fetch(`/api/shelves/${shelfId}/books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId }),
      });

      if (response.ok) {
        await fetchBookStatus();
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
      const response = await fetch(`/api/shelves/${shelfId}/books`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId }),
      });

      if (response.ok) {
        await fetchBookStatus();
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
        disabled={isLoading}
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
          <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
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
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between"
                >
                  <span>{shelf.name}</span>
                  {isLoadingThis ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
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
