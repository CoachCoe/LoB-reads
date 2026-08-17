"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import type { MappedWorkLocation, MappedAuthorLocation } from "@/server/map";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in Leaflet with webpack
const createCustomIcon = (color: string, isFictional: boolean = false) => {
  if (isFictional) {
    // Star/sparkle icon for fictional locations
    return L.divIcon({
      className: "custom-marker",
      html: `<div style="
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
      ">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="${color}" stroke="white" stroke-width="1.5">
          <path d="M12 2l2.4 7.4h7.6l-6 4.6 2.3 7-6.3-4.6-6.3 4.6 2.3-7-6-4.6h7.6z"/>
        </svg>
      </div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14],
    });
  }
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      background-color: ${color};
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 3px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};

const workIcon = createCustomIcon("#3B82F6");
const authorIcon = createCustomIcon("#22C55E");

interface LeafletMapProps {
  workLocations: MappedWorkLocation[];
  authorLocations: MappedAuthorLocation[];
  showWorks: boolean;
  showAuthors: boolean;
}

export default function LeafletMap({
  workLocations,
  authorLocations,
  showWorks,
  showAuthors,
}: LeafletMapProps) {
  useEffect(() => {
    // Fix Leaflet's default icon issue
    delete (L.Icon.Default.prototype as { _getIconUrl?: () => string })._getIconUrl;
  }, []);

  return (
    <MapContainer
      center={[30, 0]}
      zoom={2}
      style={{ height: "100%", width: "100%" }}
      className="z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {/* Where books are set */}
      {showWorks &&
        workLocations.map((location) => (
          <Marker
            key={`work-${location.id}`}
            position={[location.coordinates.lat, location.coordinates.lng]}
            icon={workIcon}
          >
            <Popup>
              <div className="min-w-[180px]">
                <p className="text-sm font-semibold text-gray-900">
                  {location.name}
                </p>
                <p className="mt-0.5 text-xs capitalize text-gray-500">
                  {location.type.replace("_", " ")}
                </p>
                <a
                  href={`/work/${location.workKey}`}
                  className="mt-2 block text-sm text-blue-600 hover:underline"
                >
                  {location.workTitle}
                </a>
                {location.workAuthor && (
                  <p className="text-xs text-gray-500">{location.workAuthor}</p>
                )}
                {location.addedBy && (
                  <p className="mt-2 text-xs text-gray-400">
                    Added by {location.addedBy}
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}

      {/* Places associated with authors */}
      {showAuthors &&
        authorLocations.map((location) => (
          <Marker
            key={`author-${location.id}`}
            position={[location.coordinates.lat, location.coordinates.lng]}
            icon={authorIcon}
          >
            <Popup>
              <div className="min-w-[180px]">
                <p className="text-sm font-semibold text-gray-900">
                  {location.name}
                </p>
                <p className="mt-0.5 text-xs capitalize text-gray-500">
                  {location.type}
                  {location.yearStart
                    ? ` · ${location.yearStart}${location.yearEnd ? `–${location.yearEnd}` : ""}`
                    : ""}
                </p>
                <a
                  href={`/author/${encodeURIComponent(location.authorName)}`}
                  className="mt-2 block text-sm text-green-700 hover:underline"
                >
                  {location.authorName}
                </a>
                {location.addedBy && (
                  <p className="mt-2 text-xs text-gray-400">
                    Added by {location.addedBy}
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}
