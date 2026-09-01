"use client";

import { useState, useEffect } from "react";
import { MapPin, Sparkles } from "lucide-react";
import { useCrowdsourcedLocations } from "@/components/locations/useCrowdsourcedLocations";
import LocationsPanel, {
  LocationsPanelSkeleton,
} from "@/components/locations/LocationsPanel";
import LocationRow from "@/components/locations/LocationRow";
import LocationField, {
  locationInputClass,
} from "@/components/locations/LocationField";
import { useToast } from "@/components/providers/ToastProvider";
import type { WorkLocationData } from "@/server/work-locations";
import type { FictionalWorldWithWorks } from "@/server/fictional-worlds";

interface WorkLocationsSectionProps {
  workKey: string;
  currentUserId?: string;
  /** Moderators may remove any contribution — PRD section 2. */
  canModerate?: boolean;
}

/** The endpoint returns a bare array; the author endpoint wraps it. */
const extractLocations = (payload: unknown) => payload as WorkLocationData[];

const LOCATION_TYPES = [
  {
    value: "setting",
    label: "Primary Setting",
    description: "Where the main story takes place",
  },
  {
    value: "mentioned",
    label: "Mentioned Location",
    description: "A place referenced in the book",
  },
  {
    value: "inspired_by",
    label: "Inspired By",
    description: "Real location that inspired the story",
  },
];

/**
 * Places a book is set in or mentions — contributed by readers.
 *
 * The card, form shell, empty state, row layout and delete confirmation are
 * shared with AuthorLocationsSection; what is here is what differs, which is
 * the type list and the fictional/real split. See LocationsPanel for why the
 * split is drawn where it is.
 */
export default function WorkLocationsSection({
  workKey,
  currentUserId,
  canModerate = false,
}: WorkLocationsSectionProps) {
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
  const { showToast } = useToast();

  const [fictionalWorlds, setFictionalWorlds] = useState<
    FictionalWorldWithWorks[]
  >([]);
  const [showAddForm, setShowAddForm] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // The route rejects a real-world location without coordinates, so blocking
    // here means the reader sees the requirement on the field rather than a red
    // toast after submitting a form that presented them as optional.
    if (!isFictional && (!lat.trim() || !lng.trim())) {
      showToast("A real-world location needs both coordinates", "error");
      return;
    }

    if (isFictional && !fictionalWorldId) {
      // Accepted by the route, then filtered out of the map by
      // getMappedWorkLocations — stored and visible nowhere.
      showToast("Choose which fictional world this place belongs to", "error");
      return;
    }

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

  const typeLabel = (value: string) =>
    LOCATION_TYPES.find((t) => t.value === value)?.label ?? value;

  if (loading) return <LocationsPanelSkeleton />;

  return (
    <LocationsPanel
      title="Locations in this Book"
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
          <LocationField label="Location Name" htmlFor="work-location-name">
            <input
              id="work-location-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Paris, France or Hogwarts"
              className={locationInputClass}
              required
            />
          </LocationField>

          <LocationField label="Type" htmlFor="work-location-type">
            <select
              id="work-location-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={locationInputClass}
            >
              {LOCATION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} — {t.description}
                </option>
              ))}
            </select>
          </LocationField>

          <div className="flex items-center gap-3">
            <input
              id="work-location-fictional"
              type="checkbox"
              checked={isFictional}
              onChange={(e) => setIsFictional(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--input-border)] text-purple-600 focus:ring-2 focus:ring-purple-500"
            />
            <label
              htmlFor="work-location-fictional"
              className="text-sm text-[var(--foreground-secondary)]"
            >
              This is a fictional location
            </label>
          </div>

          {isFictional ? (
            <LocationField
              label="Fictional World (optional)"
              htmlFor="work-location-world"
            >
              <select
                id="work-location-world"
                value={fictionalWorldId}
                onChange={(e) => setFictionalWorldId(e.target.value)}
                className={locationInputClass}
              >
                <option value="">Select a world…</option>
                {fictionalWorlds.map((world) => (
                  <option key={world.id} value={world.id}>
                    {world.name}
                  </option>
                ))}
              </select>
            </LocationField>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <LocationField
                label="Latitude"
                htmlFor="work-location-lat"
              >
                <input
                  id="work-location-lat"
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  placeholder="e.g., 48.8566"
                  className={locationInputClass}
                />
              </LocationField>
              <LocationField
                label="Longitude"
                htmlFor="work-location-lng"
              >
                <input
                  id="work-location-lng"
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  placeholder="e.g., 2.3522"
                  className={locationInputClass}
                />
              </LocationField>
            </div>
          )}

          <LocationField label="Description" htmlFor="work-location-description">
            <textarea
              id="work-location-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="How does this location feature in the book?"
              rows={2}
              className={locationInputClass}
            />
          </LocationField>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-[#D4A017] py-2 text-[var(--color-primary-contrast)] hover:bg-[#B8860B] disabled:opacity-50"
          >
            {submitting ? "Adding…" : "Add Location"}
          </button>
        </>
      }
    >
      {locations.map((location) => (
        <LocationRow
          key={location.id}
          name={location.name}
          typeLabel={typeLabel(location.type)}
          highlighted={location.isFictional}
          icon={
            location.isFictional ? (
              <Sparkles className="h-4 w-4 text-purple-500" aria-hidden="true" />
            ) : (
              <MapPin className="h-4 w-4 text-[#D4A017]" aria-hidden="true" />
            )
          }
          description={location.description}
          addedByName={location.addedBy?.name}
          meta={
            location.fictionalWorldName ? (
              <span className="rounded-full bg-purple-500/10 px-2 py-0.5 text-xs text-purple-600 dark:text-purple-300">
                {location.fictionalWorldName}
              </span>
            ) : null
          }
          onDelete={
            canModerate ||
            (location.addedBy != null && currentUserId === location.addedBy.id)
              ? () => setPendingDelete(location)
              : undefined
          }
        />
      ))}
    </LocationsPanel>
  );
}
