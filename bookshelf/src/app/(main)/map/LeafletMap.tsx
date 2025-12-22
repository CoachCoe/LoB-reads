"use client";

// Force cache bust: v2
import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import { BookLocation } from "@/server/map";
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

const settingIcon = createCustomIcon("#7047EB");
const fictionalSettingIcon = createCustomIcon("#9333EA", true);
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
              icon={book.isFictional ? fictionalSettingIcon : settingIcon}
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
                      {book.isFictional && book.fictionalWorldName && (
                        <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                          <span>✨</span>
                          {book.fictionalWorldName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <p className={`text-xs font-medium ${book.isFictional ? "text-purple-600" : "text-[#7047EB]"}`}>
                      {book.isFictional ? "Fictional setting:" : "Story set in:"}
                    </p>
                    <p className="text-xs text-gray-600">
                      {book.settingLocation}
                    </p>
                  </div>
                  <a
                    href={`/book/${book.id}`}
                    className={`mt-2 block text-center text-xs text-white py-1.5 rounded-full transition-colors ${
                      book.isFictional
                        ? "bg-purple-600 hover:bg-purple-700"
                        : "bg-[#7047EB] hover:bg-[#5a35d4]"
                    }`}
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
