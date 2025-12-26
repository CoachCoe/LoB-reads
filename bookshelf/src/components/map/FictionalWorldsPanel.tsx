"use client";

import { useState, useRef } from "react";
import { X, Upload, BookOpen, Map, Sparkles, Trash2, Plus, Edit2, ChevronLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

interface FictionalWorldMap {
  id: string;
  imageUrl: string;
  title: string;
  description: string | null;
  createdAt: Date;
}

interface FictionalWorld {
  id: string;
  name: string;
  description: string | null;
  mapImageUrl: string | null; // deprecated
  maps: FictionalWorldMap[];
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
  const [viewingMap, setViewingMap] = useState<FictionalWorldMap | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [editingMap, setEditingMap] = useState<FictionalWorldMap | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form state
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetUploadForm = () => {
    setUploadTitle("");
    setUploadDescription("");
    setSelectedFile(null);
    setShowUploadForm(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUpload = async () => {
    if (!selectedWorld || !selectedFile || !uploadTitle.trim()) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", uploadTitle.trim());
      if (uploadDescription.trim()) {
        formData.append("description", uploadDescription.trim());
      }

      const response = await fetch(`/api/fictional-worlds/${selectedWorld.id}/upload`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const newMap = data.map;

        // Update worlds list with new map
        const updatedWorlds = worlds.map((w) =>
          w.id === selectedWorld.id
            ? { ...w, maps: [newMap, ...w.maps] }
            : w
        );
        onWorldsUpdate(updatedWorlds);
        setSelectedWorld({ ...selectedWorld, maps: [newMap, ...selectedWorld.maps] });
        resetUploadForm();
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

  const handleDeleteMap = async (mapId: string) => {
    if (!confirm("Are you sure you want to delete this map?")) return;
    if (!selectedWorld) return;

    setIsDeleting(mapId);
    try {
      const response = await fetch(`/api/fictional-worlds/maps/${mapId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        const updatedMaps = selectedWorld.maps.filter((m) => m.id !== mapId);
        const updatedWorlds = worlds.map((w) =>
          w.id === selectedWorld.id ? { ...w, maps: updatedMaps } : w
        );
        onWorldsUpdate(updatedWorlds);
        setSelectedWorld({ ...selectedWorld, maps: updatedMaps });
        if (viewingMap?.id === mapId) {
          setViewingMap(null);
        }
      } else {
        const error = await response.json();
        alert(error.error || "Failed to delete map");
      }
    } catch (error) {
      console.error("Delete error:", error);
      alert("Failed to delete map");
    } finally {
      setIsDeleting(null);
    }
  };

  const handleUpdateMap = async () => {
    if (!editingMap || !selectedWorld) return;

    setIsSaving(true);
    try {
      const response = await fetch(`/api/fictional-worlds/maps/${editingMap.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editingMap.title,
          description: editingMap.description,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const updatedMap = data.map;

        const updatedMaps = selectedWorld.maps.map((m) =>
          m.id === updatedMap.id ? updatedMap : m
        );
        const updatedWorlds = worlds.map((w) =>
          w.id === selectedWorld.id ? { ...w, maps: updatedMaps } : w
        );
        onWorldsUpdate(updatedWorlds);
        setSelectedWorld({ ...selectedWorld, maps: updatedMaps });
        if (viewingMap?.id === updatedMap.id) {
          setViewingMap(updatedMap);
        }
        setEditingMap(null);
      } else {
        const error = await response.json();
        alert(error.error || "Failed to update map");
      }
    } catch (error) {
      console.error("Update error:", error);
      alert("Failed to update map");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Get thumbnail for world list (first map image)
  const getWorldThumbnail = (world: FictionalWorld) => {
    if (world.maps.length > 0) return world.maps[0].imageUrl;
    return world.mapImageUrl; // fallback to deprecated field
  };

  return (
    <div className="absolute inset-0 z-[1001] flex">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto h-full w-full max-w-md bg-white dark:bg-gray-900 shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            {selectedWorld && (
              <button
                onClick={() => {
                  setSelectedWorld(null);
                  resetUploadForm();
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors mr-1"
              >
                <ChevronLeft className="h-5 w-5 text-gray-500" />
              </button>
            )}
            <Sparkles className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {selectedWorld ? selectedWorld.name : "Fictional Worlds"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {selectedWorld ? (
            // World Detail View
            <div className="p-4">
              {/* Description */}
              {selectedWorld.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  {selectedWorld.description}
                </p>
              )}

              {/* Maps Gallery */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                    <Map className="h-4 w-4" />
                    Maps ({selectedWorld.maps.length})
                  </h3>
                  <button
                    onClick={() => setShowUploadForm(true)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    Add Map
                  </button>
                </div>

                {selectedWorld.maps.length === 0 ? (
                  <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-8 text-center">
                    <Map className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-500 dark:text-gray-400">No maps uploaded yet</p>
                    <button
                      onClick={() => setShowUploadForm(true)}
                      className="mt-3 text-sm text-purple-600 hover:text-purple-700"
                    >
                      Upload your first map
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {selectedWorld.maps.map((map) => (
                      <button
                        key={map.id}
                        onClick={() => setViewingMap(map)}
                        className="group relative aspect-square bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-purple-500 transition-all"
                      >
                        <Image
                          src={map.imageUrl}
                          alt={map.title}
                          fill
                          className="object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                          <p className="text-white text-xs font-medium truncate">
                            {map.title}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Books in this world */}
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Books set in {selectedWorld.name} ({selectedWorld._count.books})
                </h3>
                <div className="space-y-2">
                  {selectedWorld.books.map((book) => (
                    <Link
                      key={book.id}
                      href={`/book/${book.id}`}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <div className="w-10 h-14 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden flex-shrink-0">
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
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {book.title}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
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
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
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
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left border border-gray-200 dark:border-gray-700"
                    >
                      <div className="w-16 h-12 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden flex-shrink-0">
                        {getWorldThumbnail(world) ? (
                          <Image
                            src={getWorldThumbnail(world)!}
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
                        <p className="font-medium text-gray-900 dark:text-gray-100">{world.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {world._count.books} {world._count.books === 1 ? "book" : "books"}
                          {world.maps.length > 0 && ` · ${world.maps.length} ${world.maps.length === 1 ? "map" : "maps"}`}
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

      {/* Upload Form Modal */}
      {showUploadForm && selectedWorld && (
        <div className="fixed inset-0 z-[1002] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={resetUploadForm} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Add Map to {selectedWorld.name}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  placeholder="e.g., Political Map, Geographic Overview"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Image *
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 dark:file:bg-purple-900 dark:file:text-purple-300"
                />
                <p className="text-xs text-gray-500 mt-1">JPEG, PNG, GIF, or WebP. Max 5MB.</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={resetUploadForm}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={isUploading || !selectedFile || !uploadTitle.trim()}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Upload className="h-4 w-4" />
                {isUploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {viewingMap && (
        <div className="fixed inset-0 z-[1002] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80" onClick={() => setViewingMap(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Lightbox Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {viewingMap.title}
                </h3>
                {viewingMap.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {viewingMap.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditingMap(viewingMap)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  title="Edit"
                >
                  <Edit2 className="h-4 w-4 text-gray-500" />
                </button>
                <button
                  onClick={() => handleDeleteMap(viewingMap.id)}
                  disabled={isDeleting === viewingMap.id}
                  className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </button>
                <button
                  onClick={() => setViewingMap(null)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Lightbox Image */}
            <div className="flex-1 relative min-h-[400px] bg-gray-100 dark:bg-gray-800">
              <Image
                src={viewingMap.imageUrl}
                alt={viewingMap.title}
                fill
                className="object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editingMap && (
        <div className="fixed inset-0 z-[1003] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditingMap(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Edit Map Details
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Title *
                </label>
                <input
                  type="text"
                  value={editingMap.title}
                  onChange={(e) => setEditingMap({ ...editingMap, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={editingMap.description || ""}
                  onChange={(e) => setEditingMap({ ...editingMap, description: e.target.value || null })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-800 dark:text-gray-100"
                />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingMap(null)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateMap}
                disabled={isSaving || !editingMap.title.trim()}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
