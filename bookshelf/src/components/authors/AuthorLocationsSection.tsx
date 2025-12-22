"use client";

import { useState, useEffect, useCallback } from "react";
import { MapPin, Plus, X, Globe, Trash2, Home, Briefcase, Heart } from "lucide-react";
import { AuthorLocationData } from "@/server/authors";

interface AuthorLocationsSectionProps {
  authorName: string;
  currentUserId?: string;
}

const LOCATION_TYPES = [
  { value: "birthplace", label: "Birthplace", icon: Heart, color: "text-pink-500" },
  { value: "residence", label: "Residence", icon: Home, color: "text-blue-500" },
  { value: "worked", label: "Worked", icon: Briefcase, color: "text-amber-500" },
  { value: "death", label: "Place of Death", icon: MapPin, color: "text-gray-500" },
];

export default function AuthorLocationsSection({
  authorName,
  currentUserId,
}: AuthorLocationsSectionProps) {
  const [locations, setLocations] = useState<AuthorLocationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("residence");
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch(`/api/authors/${encodeURIComponent(authorName)}/locations`);
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations || []);
      }
    } catch (error) {
      console.error("Failed to fetch locations:", error);
    } finally {
      setLoading(false);
    }
  }, [authorName]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !lat || !lng || submitting) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        description: description.trim() || undefined,
        coordinates: {
          lat: parseFloat(lat),
          lng: parseFloat(lng),
        },
      };

      if (yearStart) body.yearStart = parseInt(yearStart);
      if (yearEnd) body.yearEnd = parseInt(yearEnd);

      const res = await fetch(`/api/authors/${encodeURIComponent(authorName)}/locations`, {
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
      const res = await fetch(
        `/api/authors/${encodeURIComponent(authorName)}/locations?locationId=${locationId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setLocations(locations.filter((l) => l.id !== locationId));
      }
    } catch (error) {
      console.error("Failed to delete location:", error);
    }
  };

  const resetForm = () => {
    setName("");
    setType("residence");
    setDescription("");
    setLat("");
    setLng("");
    setYearStart("");
    setYearEnd("");
    setShowAddForm(false);
  };

  const getTypeInfo = (typeValue: string) => {
    return LOCATION_TYPES.find((t) => t.value === typeValue) || LOCATION_TYPES[1];
  };

  if (loading) {
    return <div className="animate-pulse bg-gray-100 rounded-lg p-4 h-48" />;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Globe className="h-5 w-5 text-[#5fbd74]" />
          Author Locations
        </h3>
        {currentUserId && !showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 text-sm text-[#5fbd74] hover:text-[#4da760] font-medium"
          >
            <Plus className="h-4 w-4" />
            Add Location
          </button>
        )}
      </div>

      {/* Add Location Form */}
      {showAddForm && (
        <form onSubmit={handleSubmit} className="bg-gray-50 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-900">Add a Location</h4>
            <button
              type="button"
              onClick={resetForm}
              className="text-gray-400 hover:text-gray-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Location Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Oxford, England"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5fbd74] focus:border-transparent text-sm"
                required
              />
            </div>

            {/* Location Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5fbd74] focus:border-transparent text-sm"
              >
                {LOCATION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Coordinates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Latitude *
                </label>
                <input
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="e.g., 51.7520"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5fbd74] focus:border-transparent text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Longitude *
                </label>
                <input
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="e.g., -1.2577"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5fbd74] focus:border-transparent text-sm"
                  required
                />
              </div>
            </div>

            {/* Years */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Year Start (optional)
                </label>
                <input
                  type="number"
                  value={yearStart}
                  onChange={(e) => setYearStart(e.target.value)}
                  placeholder="e.g., 1925"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5fbd74] focus:border-transparent text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Year End (optional)
                </label>
                <input
                  type="number"
                  value={yearEnd}
                  onChange={(e) => setYearEnd(e.target.value)}
                  placeholder="e.g., 1973"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5fbd74] focus:border-transparent text-sm"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add any context about this location..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#5fbd74] focus:border-transparent text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={!name.trim() || !lat || !lng || submitting}
              className="w-full py-2 bg-[#5fbd74] text-white rounded-lg hover:bg-[#4da760] disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {submitting ? "Adding..." : "Add Location"}
            </button>
          </div>
        </form>
      )}

      {/* Location List */}
      {locations.length > 0 ? (
        <div className="space-y-3">
          {locations.map((location) => {
            const typeInfo = getTypeInfo(location.type);
            const TypeIcon = typeInfo.icon;

            return (
              <div
                key={location.id}
                className="flex items-start gap-3 p-3 rounded-lg bg-gray-50"
              >
                <div className={`mt-0.5 ${typeInfo.color}`}>
                  <TypeIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">
                      {location.name}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[#5fbd74]/10 text-[#5fbd74]">
                      {typeInfo.label}
                    </span>
                    {(location.yearStart || location.yearEnd) && (
                      <span className="text-xs text-gray-500">
                        {location.yearStart || "?"} - {location.yearEnd || "?"}
                      </span>
                    )}
                  </div>
                  {location.description && (
                    <p className="text-sm text-gray-600 mt-1">
                      {location.description}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    Added by {location.addedBy.name}
                  </p>
                </div>
                {currentUserId === location.addedBy.id && (
                  <button
                    onClick={() => handleDelete(location.id)}
                    className="text-gray-400 hover:text-red-500 p-1"
                    title="Remove location"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-6 text-gray-500">
          <Globe className="h-8 w-8 mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No locations added yet</p>
          {currentUserId && !showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="text-sm text-[#5fbd74] hover:text-[#4da760] font-medium mt-2"
            >
              Be the first to add one
            </button>
          )}
        </div>
      )}
    </div>
  );
}
