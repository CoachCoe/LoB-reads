"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MapPin, BookOpen, User, Eye, EyeOff, Sparkles } from "lucide-react";
import { BookLocation } from "@/server/map";
import { FictionalWorldWithBooks } from "@/server/fictional-worlds";
import FictionalWorldsPanel from "@/components/map/FictionalWorldsPanel";

interface MapClientProps {
  books: BookLocation[];
  initialFictionalWorlds: FictionalWorldWithBooks[];
}

export default function MapClient({ books, initialFictionalWorlds }: MapClientProps) {
  const [showSettings, setShowSettings] = useState(true);
  const [showAuthors, setShowAuthors] = useState(true);
  const [showFictionalPanel, setShowFictionalPanel] = useState(false);
  const [fictionalWorlds, setFictionalWorlds] = useState(initialFictionalWorlds);
  const [MapComponent, setMapComponent] = useState<React.ComponentType<{
    books: BookLocation[];
    showSettings: boolean;
    showAuthors: boolean;
  }> | null>(null);

  useEffect(() => {
    // Dynamically import Leaflet components to avoid SSR issues
    import("./LeafletMap").then((mod) => {
      setMapComponent(() => mod.default);
    });
  }, []);

  const settingsCount = books.filter((b) => b.settingCoordinates).length;
  const authorsCount = books.filter((b) => b.authorOriginCoordinates).length;

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Controls */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Explore Books</h1>
            <p className="text-sm text-gray-500">
              Discover where stories take place and where authors call home
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Toggle for Book Settings */}
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                showSettings
                  ? "bg-[#7047EB] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {showSettings ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
              <BookOpen className="h-4 w-4" />
              Book Settings ({settingsCount})
            </button>

            {/* Toggle for Author Origins */}
            <button
              onClick={() => setShowAuthors(!showAuthors)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                showAuthors
                  ? "bg-[#5fbd74] text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {showAuthors ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
              <User className="h-4 w-4" />
              Author Origins ({authorsCount})
            </button>

            {/* Fictional Worlds Button */}
            <button
              onClick={() => setShowFictionalPanel(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-purple-600 text-white hover:bg-purple-700 transition-all"
            >
              <Sparkles className="h-4 w-4" />
              Fictional Worlds ({fictionalWorlds.length})
            </button>
          </div>
        </div>
      </div>

      {/* Map Container */}
      <div className="flex-1 relative">
        {books.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="text-center px-4">
              <MapPin className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-700 mb-2">
                No locations yet
              </h2>
              <p className="text-gray-500 max-w-md">
                Books with location data will appear on the map. Start adding
                books to your library to see where stories take place!
              </p>
              <Link
                href="/search"
                className="inline-block mt-4 px-6 py-2 bg-[#7047EB] text-white rounded-full hover:bg-[#5a35d4] transition-colors"
              >
                Discover Books
              </Link>
            </div>
          </div>
        ) : MapComponent ? (
          <MapComponent
            books={books}
            showSettings={showSettings}
            showAuthors={showAuthors}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="animate-pulse text-gray-500">Loading map...</div>
          </div>
        )}
      </div>

      {/* Legend */}
      {books.length > 0 && (
        <div className="absolute bottom-4 left-4 bg-white rounded-lg shadow-lg border border-gray-200 p-3 z-[1000]">
          <p className="text-xs font-semibold text-gray-700 mb-2">Legend</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#7047EB]" />
              <span className="text-xs text-gray-600">Book Setting</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#5fbd74]" />
              <span className="text-xs text-gray-600">Author Origin</span>
            </div>
          </div>
        </div>
      )}

      {/* Fictional Worlds Panel */}
      <FictionalWorldsPanel
        worlds={fictionalWorlds}
        isOpen={showFictionalPanel}
        onClose={() => setShowFictionalPanel(false)}
        onWorldsUpdate={setFictionalWorlds}
      />
    </div>
  );
}
