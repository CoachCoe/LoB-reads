"use client";

import { useState, useRef } from "react";
import { X, Upload, Map, Sparkles, Trash2, Plus, Edit2, ChevronLeft } from "lucide-react";
import Image from "next/image";

import type {
  FictionalWorldMap,
  FictionalWorldWithWorks as FictionalWorld,
} from "@/server/fictional-worlds";
import { useToast } from "@/components/providers/ToastProvider";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface FictionalWorldsPanelProps {
  worlds: FictionalWorld[];
  isOpen: boolean;
  onClose: () => void;
  onWorldsUpdate: (worlds: FictionalWorld[]) => void;
  /** Null when signed out. Uploading and editing require a session. */
  currentUserId: string | null;
  /** Moderators may remove any map, not only their own uploads. */
  canModerate: boolean;
}

export default function FictionalWorldsPanel({
  worlds,
  isOpen,
  onClose,
  onWorldsUpdate,
  currentUserId,
  canModerate,
}: FictionalWorldsPanelProps) {
  // Creating a world. `POST /api/fictional-worlds` and createFictionalWorldSchema
  // have always existed and nothing called them, so on any database that had not
  // been dev-seeded there were no worlds — and with no worlds the entire
  // upload/edit/delete chain below, and WorkLocationsSection's world picker, were
  // unreachable. Audit BLOCK-4.
  const [newWorldName, setNewWorldName] = useState("");
  const [creatingWorld, setCreatingWorld] = useState(false);
  const [showCreateWorld, setShowCreateWorld] = useState(false);
  const [selectedWorld, setSelectedWorld] = useState<FictionalWorld | null>(null);
  const [viewingMap, setViewingMap] = useState<FictionalWorldMap | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [editingMap, setEditingMap] = useState<FictionalWorldMap | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [mapPendingDelete, setMapPendingDelete] = useState<FictionalWorldMap | null>(null);
  const { showToast } = useToast();

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
        showToast("Map uploaded");
      } else {
        const error = await response.json();
        showToast(error.error || "Failed to upload image", "error");
      }
    } catch (error) {
      console.error("Upload error:", error);
      showToast("Failed to upload image", "error");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteMap = async (mapId: string) => {
    if (!selectedWorld) return;

    setIsDeleting(mapId);
    try {
      const response = await fetch(`/api/fictional-worlds/maps/${mapId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        const updatedMaps = selectedWorld.maps.filter((m: FictionalWorldMap) => m.id !== mapId);
        const updatedWorlds = worlds.map((w) =>
          w.id === selectedWorld.id ? { ...w, maps: updatedMaps } : w
        );
        onWorldsUpdate(updatedWorlds);
        setSelectedWorld({ ...selectedWorld, maps: updatedMaps });
        if (viewingMap?.id === mapId) {
          setViewingMap(null);
        }
        showToast("Map deleted");
      } else {
        const error = await response.json();
        showToast(error.error || "Failed to delete map", "error");
      }
    } catch (error) {
      console.error("Delete error:", error);
      showToast("Failed to delete map", "error");
    } finally {
      setIsDeleting(null);
      setMapPendingDelete(null);
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

        const updatedMaps = selectedWorld.maps.map((m: FictionalWorldMap) =>
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
        showToast("Map updated");
      } else {
        const error = await response.json();
        showToast(error.error || "Failed to update map", "error");
      }
    } catch (error) {
      console.error("Update error:", error);
      showToast("Failed to update map", "error");
    } finally {
      setIsSaving(false);
    }
  };

  async function createWorld(event: React.FormEvent) {
    event.preventDefault();
    const name = newWorldName.trim();
    if (!name) return;

    setCreatingWorld(true);
    try {
      const response = await fetch("/api/fictional-worlds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        showToast(error.error || "Could not create that world", "error");
        return;
      }

      // The route returns the world itself, not `{ world }` — unlike the upload
      // route next to it, which returns `{ map }`.
      const world: FictionalWorld = await response.json();
      onWorldsUpdate(
        [...worlds, world].sort((a, b) => a.name.localeCompare(b.name))
      );
      setNewWorldName("");
      setShowCreateWorld(false);
      showToast(`Created ${name}`);
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    } finally {
      setCreatingWorld(false);
    }
  }

  if (!isOpen) return null;

  // Get thumbnail for world list (first map image)
  const getWorldThumbnail = (world: FictionalWorld) =>
    world.maps[0]?.imageUrl ?? null;

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
                aria-label="Back to all fictional worlds"
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
            aria-label="Close fictional worlds panel"
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
                    {selectedWorld.maps.map((map: FictionalWorldMap) => (
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
            </div>
          ) : (
            // Worlds List View
            <div className="p-4">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Explore fictional worlds from the books in our library. Upload custom maps to visualize where these stories take place.
              </p>

              {currentUserId && (
                <div className="mb-4">
                  {showCreateWorld ? (
                    <form onSubmit={createWorld} className="flex items-end gap-2">
                      <div className="flex-1">
                        <label
                          htmlFor="new-world-name"
                          className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
                        >
                          World name
                        </label>
                        <input
                          id="new-world-name"
                          value={newWorldName}
                          onChange={(e) => setNewWorldName(e.target.value)}
                          placeholder="Middle-earth"
                          maxLength={200}
                          autoFocus
                          required
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={creatingWorld}
                        className="rounded-lg bg-[#D4A017] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                      >
                        {creatingWorld ? "Creating…" : "Create"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateWorld(false);
                          setNewWorldName("");
                        }}
                        className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setShowCreateWorld(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      <Plus className="h-4 w-4" />
                      New world
                    </button>
                  )}
                </div>
              )}

              {worlds.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <Sparkles className="h-12 w-12 mx-auto mb-2" />
                  <p>No fictional worlds yet</p>
                  {!currentUserId && (
                    <p className="mt-1 text-xs">Sign in to add one.</p>
                  )}
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
                          {world.workCount} {world.workCount === 1 ? "book" : "books"}
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
                {/* Maps are community-editable, so any signed-in user may
                    correct the details. */}
                {currentUserId && (
                  <button
                    onClick={() => setEditingMap(viewingMap)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    title="Edit"
                    aria-label={`Edit details for ${viewingMap.title}`}
                  >
                    <Edit2 className="h-4 w-4 text-gray-500" />
                  </button>
                )}
                {/* Deletion is destructive, so it matches the API rule:
                    uploader or moderator only. */}
                {(canModerate || viewingMap.addedById === currentUserId) && (
                  <button
                    onClick={() => setMapPendingDelete(viewingMap)}
                    disabled={isDeleting === viewingMap.id}
                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    title="Delete"
                    aria-label={`Delete map ${viewingMap.title}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-500" />
                  </button>
                )}
                <button
                  onClick={() => setViewingMap(null)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  aria-label="Close map viewer"
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

      <ConfirmDialog
        open={mapPendingDelete !== null}
        title="Delete this map?"
        message={
          mapPendingDelete
            ? `"${mapPendingDelete.title}" will be removed for everyone. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete map"
        destructive
        busy={isDeleting === mapPendingDelete?.id}
        onConfirm={() => {
          if (mapPendingDelete) handleDeleteMap(mapPendingDelete.id);
        }}
        onCancel={() => setMapPendingDelete(null)}
      />
    </div>
  );
}
