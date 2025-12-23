"use client";

import { useState, useEffect, useCallback } from "react";
import { MapPin, Plus, X, Sparkles, Globe, Trash2 } from "lucide-react";
import { BookLocationData } from "@/server/book-locations";
import { FictionalWorldWithBooks } from "@/server/fictional-worlds";

interface BookLocationsSectionProps {
  bookId: string;
  currentUserId?: string;
}

const LOCATION_TYPES = [
  { value: "setting", label: "Primary Setting", description: "Where the main story takes place" },
  { value: "mentioned", label: "Mentioned Location", description: "A place referenced in the book" },
  { value: "inspired_by", label: "Inspired By", description: "Real location that inspired the story" },
];

export default function BookLocationsSection({ bookId, currentUserId }: BookLocationsSectionProps) {
  const [locations, setLocations] = useState<BookLocationData[]>([]);
  const [fictionalWorlds, setFictionalWorlds] = useState<FictionalWorldWithBooks[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("setting");
  const [description, setDescription] = useState("");
  const [isFictional, setIsFictional] = useState(false);
  const [fictionalWorldId, setFictionalWorldId] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch(`/api/books/${bookId}/locations`);
      if (res.ok) {
        const data = await res.json();
        setLocations(data);
      }
    } catch (error) {
      console.error("Failed to fetch locations:", error);
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  const fetchFictionalWorlds = useCallback(async () => {
    try {
      const res = await fetch("/api/fictional-worlds");
      if (res.ok) {
        const data = await res.json();
        setFictionalWorlds(data);
      }
    } catch (error) {
      console.error("Failed to fetch fictional worlds:", error);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
    fetchFictionalWorlds();
  }, [fetchLocations, fetchFictionalWorlds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || submitting) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        isFictional,
      };

      if (isFictional && fictionalWorldId) {
        body.fictionalWorldId = fictionalWorldId;
      } else if (!isFictional && lat && lng) {
        body.coordinates = {
          lat: parseFloat(lat),
          lng: parseFloat(lng),
        };
      }

      const res = await fetch(`/api/books/${bookId}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        resetForm();
        fetchLocations();
      }
    } catch (error) {
      console.error("Failed to add location:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (locationId: string) => {
    if (!confirm("Remove this location?")) return;

    try {
      const res = await fetch(`/api/books/${bookId}/locations?locationId=${locationId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setLocations(locations.filter((l) => l.id !== locationId));
      }
    } catch (error) {
      console.error("Failed to delete location:", error);
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
          <MapPin className="h-5 w-5 text-[#7047EB]" />
          Locations
        </h3>
        {currentUserId && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 text-sm text-[#7047EB] hover:text-[#5a35d4] font-medium"
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
                className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#7047EB] focus:border-transparent text-sm"
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
                className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#7047EB] focus:border-transparent text-sm"
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
                    className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#7047EB] focus:border-transparent text-sm"
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
                    className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#7047EB] focus:border-transparent text-sm"
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
                className="w-full px-3 py-2 border border-[var(--input-border)] bg-[var(--input-bg)] text-[var(--foreground)] rounded-lg focus:ring-2 focus:ring-[#7047EB] focus:border-transparent text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="w-full py-2 bg-[#7047EB] text-white rounded-lg hover:bg-[#5a35d4] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
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
              className={`flex items-start gap-3 p-3 rounded-lg ${
                location.isFictional ? "bg-purple-500/10" : "bg-[var(--border-light)]"
              }`}
            >
              <div className={`mt-0.5 ${location.isFictional ? "text-purple-500" : "text-[#7047EB]"}`}>
                {location.isFictional ? (
                  <Sparkles className="h-4 w-4" />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[var(--foreground)]">{location.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    location.type === "setting"
                      ? "bg-[#7047EB]/10 text-[#7047EB]"
                      : location.type === "mentioned"
                      ? "bg-blue-500/10 text-blue-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}>
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
                  Added by {location.addedBy.name}
                </p>
              </div>
              {currentUserId === location.addedBy.id && (
                <button
                  onClick={() => handleDelete(location.id)}
                  className="text-[var(--foreground-secondary)] hover:text-red-500 p-1"
                  title="Remove location"
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
              className="text-sm text-[#7047EB] hover:text-[#5a35d4] font-medium mt-2"
            >
              Be the first to add one
            </button>
          )}
        </div>
      )}
    </div>
  );
}
