"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { MapPin, BookOpen, User, Eye, EyeOff, Sparkles } from "lucide-react";
import type { MappedWorkLocation, MappedAuthorLocation } from "@/server/map";
import type { FictionalWorldWithWorks } from "@/server/fictional-worlds";
import FictionalWorldsPanel from "@/components/map/FictionalWorldsPanel";

interface MapClientProps {
  workLocations: MappedWorkLocation[];
  authorLocations: MappedAuthorLocation[];
  initialFictionalWorlds: FictionalWorldWithWorks[];
  currentUserId: string | null;
  canModerate: boolean;
}

export default function MapClient({
  workLocations,
  authorLocations,
  initialFictionalWorlds,
  currentUserId,
  canModerate,
}: MapClientProps) {
  const [showWorks, setShowWorks] = useState(true);
  const [showAuthors, setShowAuthors] = useState(true);
  const [showFictionalPanel, setShowFictionalPanel] = useState(false);
  const [fictionalWorlds, setFictionalWorlds] = useState(initialFictionalWorlds);
  const [MapComponent, setMapComponent] = useState<React.ComponentType<{
    workLocations: MappedWorkLocation[];
    authorLocations: MappedAuthorLocation[];
    showWorks: boolean;
    showAuthors: boolean;
  }> | null>(null);

  useEffect(() => {
    // Dynamically import Leaflet components to avoid SSR issues
    import("./LeafletMap").then((mod) => {
      setMapComponent(() => mod.default);
    });
  }, []);

  const worksCount = workLocations.length;
  const authorsCount = authorLocations.length;

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Controls */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Explore Books</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Discover where stories take place and where authors call home
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Toggle for Book Settings */}
            <button
              onClick={() => setShowWorks(!showWorks)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${ showWorks ? "bg-[#3B82F6] text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700" }`}
            >
              {showWorks ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
              <BookOpen className="h-4 w-4" />
              Book settings ({worksCount})
            </button>

            {/* Toggle for Author Origins */}
            <button
              onClick={() => setShowAuthors(!showAuthors)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all ${ showAuthors ? "bg-[#22C55E] text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700" }`}
            >
              {showAuthors ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
              <User className="h-4 w-4" />
              Author places ({authorsCount})
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
        {worksCount === 0 && authorsCount === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
            <div className="text-center px-4">
              <MapPin className="h-16 w-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                No locations yet
              </h2>
              <p className="text-gray-500 dark:text-gray-400 max-w-md">
                Books with location data will appear on the map. Start adding
                books to your library to see where stories take place!
              </p>
              <Link
                href="/search"
                className="inline-block mt-4 px-6 py-2 bg-[#D4A017] text-[var(--color-primary-contrast)] rounded-full hover:bg-[#B8860B] transition-colors"
              >
                Discover Books
              </Link>
            </div>
          </div>
        ) : MapComponent ? (
          <MapComponent
            workLocations={workLocations}
            authorLocations={authorLocations}
            showWorks={showWorks}
            showAuthors={showAuthors}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-800">
            <div className="animate-pulse text-gray-500 dark:text-gray-400">Loading map...</div>
          </div>
        )}
      </div>

      {/* Legend */}
      {(worksCount > 0 || authorsCount > 0) && (
        <div className="absolute bottom-4 left-4 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-3 z-[1000]">
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Legend</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#3B82F6]" />
              <span className="text-xs text-gray-600 dark:text-gray-400">Book setting</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#22C55E]" />
              <span className="text-xs text-gray-600 dark:text-gray-400">Author place</span>
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
        currentUserId={currentUserId}
        canModerate={canModerate}
      />
    </div>
  );
}
