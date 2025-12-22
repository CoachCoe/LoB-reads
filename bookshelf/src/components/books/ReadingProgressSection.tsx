"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { BookOpen, Check } from "lucide-react";
import Button from "@/components/ui/Button";
import ProgressBar from "@/components/ui/ProgressBar";
import Input from "@/components/ui/Input";

interface ReadingProgressSectionProps {
  bookId: string;
  pageCount: number | null;
}

interface Progress {
  currentPage: number;
  finishedAt: string | null;
}

export default function ReadingProgressSection({
  bookId,
  pageCount,
}: ReadingProgressSectionProps) {
  const { data: session } = useSession();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [pageInput, setPageInput] = useState("");
  const [isEditing, setIsEditing] = useState(false);

  const fetchProgress = useCallback(async () => {
    try {
      const response = await fetch(`/api/progress?bookId=${bookId}`);
      if (response.ok) {
        const data = await response.json();
        const bookProgress = data.find(
          (p: { bookId: string }) => p.bookId === bookId
        );
        if (bookProgress) {
          setProgress(bookProgress);
          setPageInput(bookProgress.currentPage.toString());
        }
      }
    } catch (error) {
      console.error("Failed to fetch progress:", error);
    }
  }, [bookId]);

  useEffect(() => {
    if (session?.user) {
      fetchProgress();
    }
  }, [session, fetchProgress]);

  const handleStartReading = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, action: "start" }),
      });

      if (response.ok) {
        const data = await response.json();
        setProgress(data);
        setPageInput("0");
      }
    } catch (error) {
      console.error("Failed to start reading:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProgress = async () => {
    const page = parseInt(pageInput);
    if (isNaN(page) || page < 0) return;

    setIsLoading(true);
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, currentPage: page }),
      });

      if (response.ok) {
        const data = await response.json();
        setProgress(data);
        setIsEditing(false);
      }
    } catch (error) {
      console.error("Failed to update progress:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinishReading = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId, action: "finish" }),
      });

      if (response.ok) {
        const data = await response.json();
        setProgress(data);
      }
    } catch (error) {
      console.error("Failed to finish reading:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!session?.user) {
    return null;
  }

  if (!progress) {
    return (
      <Button
        onClick={handleStartReading}
        variant="outline"
        isLoading={isLoading}
        className="flex items-center gap-2"
      >
        <BookOpen className="h-4 w-4" />
        Start Reading
      </Button>
    );
  }

  if (progress.finishedAt) {
    return (
      <div className="flex items-center gap-2 text-green-600">
        <Check className="h-5 w-5" />
        <span className="font-medium">Finished reading</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pageCount && (
        <ProgressBar
          value={progress.currentPage}
          max={pageCount}
        />
      )}

      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            min={0}
            max={pageCount || undefined}
            className="w-24"
          />
          <span className="text-gray-500">
            / {pageCount || "?"} pages
          </span>
          <Button
            onClick={handleUpdateProgress}
            size="sm"
            isLoading={isLoading}
          >
            Update
          </Button>
          <Button
            onClick={() => {
              setIsEditing(false);
              setPageInput(progress.currentPage.toString());
            }}
            variant="ghost"
            size="sm"
          >
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsEditing(true)}
            variant="outline"
            size="sm"
          >
            Update Progress
          </Button>
          <Button
            onClick={handleFinishReading}
            variant="secondary"
            size="sm"
            isLoading={isLoading}
          >
            Mark as Finished
          </Button>
        </div>
      )}
    </div>
  );
}
