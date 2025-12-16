"use client";

import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { BookLocation } from "@/server/map";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in Leaflet with webpack
const createCustomIcon = (color: string) => {
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

const settingIcon = createCustomIcon("#7047EB");
const authorIcon = createCustomIcon("#5fbd74");

interface LeafletMapProps {
  books: BookLocation[];
  showSettings: boolean;
  showAuthors: boolean;
}

export default function LeafletMap({
  books,
  showSettings,
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

      {/* Book Setting Markers */}
      {showSettings &&
        books
          .filter((book) => book.settingCoordinates)
          .map((book) => (
            <Marker
              key={`setting-${book.id}`}
              position={[
                book.settingCoordinates!.lat,
                book.settingCoordinates!.lng,
              ]}
              icon={settingIcon}
            >
              <Popup>
                <div className="min-w-[200px]">
                  <div className="flex gap-3">
                    {book.coverUrl && (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="w-12 h-16 object-cover rounded"
                      />
                    )}
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 text-sm">
                        {book.title}
                      </p>
                      <p className="text-xs text-gray-500">{book.author}</p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-[#7047EB] font-medium">
                      Story set in:
                    </p>
                    <p className="text-xs text-gray-600">
                      {book.settingLocation}
                    </p>
                  </div>
                  <a
                    href={`/book/${book.id}`}
                    className="mt-2 block text-center text-xs bg-[#7047EB] text-white py-1.5 rounded-full hover:bg-[#5a35d4] transition-colors"
                  >
                    View Book
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}

      {/* Author Origin Markers */}
      {showAuthors &&
        books
          .filter((book) => book.authorOriginCoordinates)
          .map((book) => (
            <Marker
              key={`author-${book.id}`}
              position={[
                book.authorOriginCoordinates!.lat,
                book.authorOriginCoordinates!.lng,
              ]}
              icon={authorIcon}
            >
              <Popup>
                <div className="min-w-[200px]">
                  <div className="flex gap-3">
                    {book.coverUrl && (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="w-12 h-16 object-cover rounded"
                      />
                    )}
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900 text-sm">
                        {book.author}
                      </p>
                      <p className="text-xs text-gray-500">{book.title}</p>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <p className="text-xs text-[#5fbd74] font-medium">
                      Author&apos;s origin:
                    </p>
                    <p className="text-xs text-gray-600">{book.authorOrigin}</p>
                  </div>
                  <a
                    href={`/book/${book.id}`}
                    className="mt-2 block text-center text-xs bg-[#5fbd74] text-white py-1.5 rounded-full hover:bg-[#4da760] transition-colors"
                  >
                    View Book
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
    </MapContainer>
  );
}
