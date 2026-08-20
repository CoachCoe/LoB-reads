"use client";

import { useState, useEffect } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useCrowdsourcedLocations } from "@/components/locations/useCrowdsourcedLocations";
import { MapPin, Plus, X, Sparkles, Globe, Trash2 } from "lucide-react";
import { WorkLocationData } from "@/server/work-locations";
import { FictionalWorldWithWorks } from "@/server/fictional-worlds";

interface WorkLocationsSectionProps {
  workKey: string;
  currentUserId?: string;
}

/** The endpoint returns a bare array; the author endpoint wraps it. */
const extractLocations = (payload: unknown) => payload as WorkLocationData[];

const LOCATION_TYPES = [
  { value: "setting", label: "Primary Setting", description: "Where the main story takes place" },
  { value: "mentioned", label: "Mentioned Location", description: "A place referenced in the book" },
  { value: "inspired_by", label: "Inspired By", description: "Real location that inspired the story" },
];

export default function WorkLocationsSection({ workKey, currentUserId }: WorkLocationsSectionProps) {
  const {
    locations,
    loading,
    submitting,
    pendingDelete,
    setPendingDelete,
    addLocation,
    removeLocation,
  } = useCrowdsourcedLocations<WorkLocationData>({
    basePath: `/api/works/${workKey}/locations`,
    extractList: extractLocations,
  });

  const [fictionalWorlds, setFictionalWorlds] = useState<FictionalWorldWithWorks[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("setting");
  const [description, setDescription] = useState("");
  const [isFictional, setIsFictional] = useState(false);
  const [fictionalWorldId, setFictionalWorldId] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  // Loaded once for the "fictional world" picker. The cancelled flag stops a
  // late response from setting state after the component has unmounted.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/fictional-worlds");
        if (res.ok && !cancelled) {
          setFictionalWorlds(await res.json());
        }
      } catch (error) {
        console.error("Failed to fetch fictional worlds:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const body: Record<string, unknown> = {
      name: name.trim(),
      type,
      description: description.trim() || undefined,
      isFictional,
    };

    if (isFictional && fictionalWorldId) {
      body.fictionalWorldId = fictionalWorldId;
    } else if (!isFictional && lat && lng) {
      body.coordinates = { lat: parseFloat(lat), lng: parseFloat(lng) };
    }

    if (await addLocation(body)) {
      resetForm();
    }
  };

  const resetForm = () => {
    setName("");
    setType("setting");
    setDescription("");
    setIsFictional(false);
    setFictionalWorldId("");
    setLat("");
    setLng("");
    setShowAddForm(false);
  };

  if (loading) {
    return (
      <div className="animate-pulse bg-[var(--border-light)] rounded-lg p-4 h-32" />
    );
  }

  return (
    <div className="bg-[var(--card-bg)] rounded-lg border border-[var(--card-border)] p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--foreground)] flex items-center gap-2">
          <MapPin className="h-5 w-5 text-[#D4A017]" />
          Locations
        </h3>
        {currentUserId && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 text-sm text-[#D4A017] hover:text-[#B8860B] font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Location
          </button>
        )}
      </div>

      {/* Add Location Form */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="bg-[var(--border-light)] rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-[var(--foreground)]">Add a Location</h4>
            <button
              type="button"
              onClick={resetForm}
              aria-label="Cancel adding a location"
              className="text-[var(--foreground-secondary)] hover:text-[var(--foreground)]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Location Name */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-1">
                Location Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Paris, Middle-earth, The Shire"
                className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#D4A017] focus:border-transparent text-sm"
                required
              />
            </div>

            {/* Location Type */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-1">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#D4A017] focus:border-transparent text-sm"
              >
                {LOCATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Fictional Toggle */}
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isFictional}
                  onChange={(e) => setIsFictional(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[var(--border)] peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[var(--border)] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
              <span className="text-sm text-[var(--foreground-secondary)]">This is a fictional location</span>
            </div>

            {/* Conditional: Fictional World or Coordinates */}
            {isFictional ? (
              <div>
                <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-1">
                  Fictional World (optional)
                </label>
                <select
                  value={fictionalWorldId}
                  onChange={(e) => setFictionalWorldId(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm"
                >
                  <option value="">Select a world...</option>
                  {fictionalWorlds.map((world) => (
                    <option key={world.id} value={world.id}>
                      {world.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-1">
                    Latitude (optional)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    placeholder="e.g., 48.8566"
                    className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#D4A017] focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-1">
                    Longitude (optional)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    placeholder="e.g., 2.3522"
                    className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#D4A017] focus:border-transparent text-sm"
                  />
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-[var(--foreground-secondary)] mb-1">
                Notes (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add any context about this location..."
                rows={2}
                className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#D4A017] focus:border-transparent text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="w-full py-2 bg-[#D4A017] text-white rounded-lg hover:bg-[#B8860B] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {submitting ? "Adding..." : "Add Location"}
            </button>
          </div>
        </form>
      )}

      {/* Location List */}
      {locations.length > 0 ? (
        <div className="space-y-3">
          {locations.map((location) => (
            <div
              key={location.id}
              className={`flex items-start gap-3 p-3 rounded-lg ${ location.isFictional ? "bg-purple-500/10" : "bg-[var(--border-light)]" }`}
            >
              <div className={`mt-0.5 ${location.isFictional ? "text-purple-500" : "text-[#D4A017]"}`}>
                {location.isFictional ? (
                  <Sparkles className="h-4 w-4" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[var(--foreground)]">{location.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${ location.type === "setting" ? "bg-[#D4A017]/10 text-[#D4A017]" : location.type === "mentioned" ? "bg-blue-500/10 text-blue-400" : "bg-amber-500/10 text-amber-400" }`}>
                    {LOCATION_TYPES.find((t) => t.value === location.type)?.label || location.type}
                  </span>
                  {location.fictionalWorldName && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                      {location.fictionalWorldName}
                    </span>
                  )}
                </div>
                {location.description && (
                  <p className="text-sm text-[var(--foreground-secondary)] mt-1">{location.description}</p>
                )}
                <p className="text-xs text-[var(--foreground-secondary)] mt-1">
                  Added by {location.addedBy?.name ?? "a former member"}
                </p>
              </div>
              {location.addedBy != null && currentUserId === location.addedBy.id && (
                <button
                  onClick={() => setPendingDelete(location)}
                  className="text-[var(--foreground-secondary)] hover:text-red-500 p-1"
                  title="Remove location"
                  aria-label={`Remove location ${location.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-[var(--foreground-secondary)]">
          <MapPin className="h-8 w-8 mx-auto mb-2 text-[var(--foreground-secondary)]" />
          <p className="text-sm">No locations added yet</p>
          {currentUserId && !showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm text-[#D4A017] hover:text-[#B8860B] font-medium mt-2"
            >
              Be the first to add one
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this location?"
        message={
          pendingDelete
            ? `"${pendingDelete.name}" will be removed from this page.`
            : ""
        }
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (pendingDelete) removeLocation(pendingDelete.id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
