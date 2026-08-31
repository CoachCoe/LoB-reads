"use client";

import { useState } from "react";
import { MapPin, Home, Briefcase, Heart } from "lucide-react";
import { useCrowdsourcedLocations } from "@/components/locations/useCrowdsourcedLocations";
import LocationsPanel, {
  LocationsPanelSkeleton,
} from "@/components/locations/LocationsPanel";
import LocationRow from "@/components/locations/LocationRow";
import LocationField, {
  locationInputClass,
} from "@/components/locations/LocationField";
import type { AuthorLocationData } from "@/server/authors";

interface AuthorLocationsSectionProps {
  authorName: string;
  currentUserId?: string;
}

/** This endpoint wraps the list; the book endpoint returns a bare array. */
const extractLocations = (payload: unknown) =>
  (payload as { locations?: AuthorLocationData[] }).locations ?? [];

const LOCATION_TYPES = [
  { value: "birthplace", label: "Birthplace", icon: Heart, color: "text-pink-500" },
  { value: "residence", label: "Residence", icon: Home, color: "text-blue-500" },
  { value: "worked", label: "Worked", icon: Briefcase, color: "text-amber-500" },
  { value: "death", label: "Place of Death", icon: MapPin, color: "text-gray-500" },
];

/**
 * Where an author lived, worked, was born and died — contributed by readers.
 *
 * The card, form shell, empty state, row layout and delete confirmation are
 * shared with WorkLocationsSection; what is here is what differs, which is the
 * type list and the year range. See LocationsPanel for why the split is drawn
 * where it is.
 */
export default function AuthorLocationsSection({
  authorName,
  currentUserId,
}: AuthorLocationsSectionProps) {
  const {
    locations,
    loading,
    submitting,
    pendingDelete,
    setPendingDelete,
    addLocation,
    removeLocation,
  } = useCrowdsourcedLocations<AuthorLocationData>({
    basePath: `/api/authors/${encodeURIComponent(authorName)}/locations`,
    extractList: extractLocations,
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("residence");
  const [description, setDescription] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [yearStart, setYearStart] = useState("");
  const [yearEnd, setYearEnd] = useState("");

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !lat || !lng) return;

    const body: Record<string, unknown> = {
      name: name.trim(),
      type,
      description: description.trim() || undefined,
      coordinates: { lat: parseFloat(lat), lng: parseFloat(lng) },
    };

    if (yearStart) body.yearStart = parseInt(yearStart);
    if (yearEnd) body.yearEnd = parseInt(yearEnd);

    if (await addLocation(body)) {
      resetForm();
    }
  };

  const typeInfo = (value: string) =>
    LOCATION_TYPES.find((t) => t.value === value) ?? LOCATION_TYPES[1];

  if (loading) return <LocationsPanelSkeleton />;

  return (
    <LocationsPanel
      title="Author Locations"
      canContribute={Boolean(currentUserId)}
      formOpen={showAddForm}
      onOpenForm={() => setShowAddForm(true)}
      onCloseForm={resetForm}
      onSubmit={handleSubmit}
      isEmpty={locations.length === 0}
      pendingDeleteName={pendingDelete?.name ?? null}
      onConfirmDelete={() => {
        if (pendingDelete) removeLocation(pendingDelete.id);
      }}
      onCancelDelete={() => setPendingDelete(null)}
      form={
        <>
          <LocationField label="Location Name" htmlFor="author-location-name">
            <input
              id="author-location-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Oxford, England"
              className={locationInputClass}
              required
            />
          </LocationField>

          <LocationField label="Type" htmlFor="author-location-type">
            <select
              id="author-location-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={locationInputClass}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </LocationField>

          <div className="grid grid-cols-2 gap-3">
            <LocationField label="Latitude" htmlFor="author-location-lat">
              <input
                id="author-location-lat"
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="e.g., 51.7520"
                className={locationInputClass}
                required
              />
            </LocationField>
            <LocationField label="Longitude" htmlFor="author-location-lng">
              <input
                id="author-location-lng"
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="e.g., -1.2577"
                className={locationInputClass}
                required
              />
            </LocationField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <LocationField label="From (year)" htmlFor="author-location-from">
              <input
                id="author-location-from"
                type="number"
                value={yearStart}
                onChange={(e) => setYearStart(e.target.value)}
                placeholder="e.g., 1925"
                className={locationInputClass}
              />
            </LocationField>
            <LocationField label="To (year)" htmlFor="author-location-to">
              <input
                id="author-location-to"
                type="number"
                value={yearEnd}
                onChange={(e) => setYearEnd(e.target.value)}
                placeholder="e.g., 1973"
                className={locationInputClass}
              />
            </LocationField>
          </div>

          <LocationField label="Description" htmlFor="author-location-description">
            <textarea
              id="author-location-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add any context about this location..."
              rows={2}
              className={locationInputClass}
            />
          </LocationField>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#D4A017] py-2 text-white hover:bg-[#B8860B] disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add Location"}
          </button>
        </>
      }
    >
      {locations.map((location) => {
        const info = typeInfo(location.type);
        const Icon = info.icon;
        const years = location.yearStart || location.yearEnd;

        return (
          <LocationRow
            key={location.id}
            name={location.name}
            typeLabel={info.label}
            icon={<Icon className={`h-4 w-4 ${info.color}`} aria-hidden="true" />}
            description={location.description}
            addedByName={location.addedBy?.name}
            meta={
              years ? (
                <span className="text-xs text-[var(--foreground-secondary)]">
                  {location.yearStart || "?"} - {location.yearEnd || "?"}
                </span>
              ) : null
            }
            onDelete={
              location.addedBy != null && currentUserId === location.addedBy.id
                ? () => setPendingDelete(location)
                : undefined
            }
          />
        );
      })}
    </LocationsPanel>
  );
}
