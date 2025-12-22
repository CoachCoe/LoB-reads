"use client";

import { useState } from "react";
import { X, Upload, BookOpen, Map, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface FictionalWorld {
  id: string;
  name: string;
  description: string | null;
  mapImageUrl: string | null;
  _count: {
    books: number;
  };
  books: {
    id: string;
    title: string;
    author: string;
    coverUrl: string | null;
  }[];
}

interface FictionalWorldsPanelProps {
  worlds: FictionalWorld[];
  isOpen: boolean;
  onClose: () => void;
  onWorldsUpdate: (worlds: FictionalWorld[]) => void;
}

export default function FictionalWorldsPanel({
  worlds,
  isOpen,
  onClose,
  onWorldsUpdate,
}: FictionalWorldsPanelProps) {
  const [selectedWorld, setSelectedWorld] = useState<FictionalWorld | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (worldId: string, file: File) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/fictional-worlds/${worldId}/upload`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        // Update the worlds list with the new map image
        const updatedWorlds = worlds.map((w) =>
          w.id === worldId ? { ...w, mapImageUrl: data.url } : w
        );
        onWorldsUpdate(updatedWorlds);
        if (selectedWorld?.id === worldId) {
          setSelectedWorld({ ...selectedWorld, mapImageUrl: data.url });
        }
      } else {
        const error = await response.json();
        alert(error.error || "Failed to upload image");
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Failed to upload image");
    } finally {
      setIsUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-[1001] flex">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative ml-auto h-full w-full max-w-md bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              {selectedWorld ? selectedWorld.name : "Fictional Worlds"}
            </h2>
          </div>
          <button
            onClick={selectedWorld ? () => setSelectedWorld(null) : onClose}
            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {selectedWorld ? (
            // World Detail View
            <div className="p-4">
              {/* Map Image */}
              <div className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden mb-4">
                {selectedWorld.mapImageUrl ? (
                  <Image
                    src={selectedWorld.mapImageUrl}
                    alt={`Map of ${selectedWorld.name}`}
                    fill
                    className="object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
                    <Map className="h-12 w-12 mb-2" />
                    <p className="text-sm">No map uploaded yet</p>
                  </div>
                )}
              </div>

              {/* Upload Button */}
              <label className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors cursor-pointer mb-4">
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading..." : "Upload Map Image"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileUpload(selectedWorld.id, file);
                    }
                  }}
                />
              </label>

              {/* Description */}
              {selectedWorld.description && (
                <p className="text-sm text-gray-600 mb-4">
                  {selectedWorld.description}
                </p>
              )}

              {/* Books in this world */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Books set in {selectedWorld.name} ({selectedWorld._count.books})
                </h3>
                <div className="space-y-2">
                  {selectedWorld.books.map((book) => (
                    <Link
                      key={book.id}
                      href={`/book/${book.id}`}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="w-10 h-14 bg-gray-200 rounded overflow-hidden flex-shrink-0">
                        {book.coverUrl ? (
                          <Image
                            src={book.coverUrl}
                            alt={book.title}
                            width={40}
                            height={56}
                            className="w-full h-full object-cover"
                            unoptimized
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <BookOpen className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {book.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {book.author}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            // Worlds List View
            <div className="p-4">
              <p className="text-sm text-gray-500 mb-4">
                Explore fictional worlds from the books in our library. Upload custom maps to visualize where these stories take place.
              </p>

              {worlds.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Sparkles className="h-12 w-12 mx-auto mb-2" />
                  <p>No fictional worlds yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {worlds.map((world) => (
                    <button
                      key={world.id}
                      onClick={() => setSelectedWorld(world)}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left border border-gray-200"
                    >
                      <div className="w-16 h-12 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                        {world.mapImageUrl ? (
                          <Image
                            src={world.mapImageUrl}
                            alt={world.name}
                            width={64}
                            height={48}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <Map className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{world.name}</p>
                        <p className="text-xs text-gray-500">
                          {world._count.books} {world._count.books === 1 ? "book" : "books"}
                        </p>
                      </div>
                      <Sparkles className="h-4 w-4 text-purple-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
