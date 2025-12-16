"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { BookOpen, Search, Menu, X, LogOut, User, BookMarked, Home, Sparkles, Settings, MapPin } from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";

export default function Navbar() {
  const { data: session, status } = useSession();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const isLoading = status === "loading";
  const isAuthenticated = status === "authenticated";

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo and main nav */}
          <div className="flex items-center">
            <Link
              href="/"
              className="flex items-center gap-2 text-[#7047EB] hover:text-[#5a35d4] transition-colors"
            >
              <BookOpen className="h-8 w-8" />
              <span className="text-xl font-bold hidden sm:block">Life on Books</span>
            </Link>

            {/* Desktop nav links */}
            {isAuthenticated && (
              <div className="hidden md:flex ml-10 space-x-1">
                <Link
                  href="/"
                  className="flex items-center gap-1.5 px-4 py-2 text-gray-600 hover:text-[#7047EB] rounded-full hover:bg-[#7047EB]/5 transition-all"
                >
                  <Home className="h-4 w-4" />
                  Home
                </Link>
                <Link
                  href="/my-books"
                  className="flex items-center gap-1.5 px-4 py-2 text-gray-600 hover:text-[#7047EB] rounded-full hover:bg-[#7047EB]/5 transition-all"
                >
                  <BookMarked className="h-4 w-4" />
                  My Books
                </Link>
                <Link
                  href="/search"
                  className="flex items-center gap-1.5 px-4 py-2 text-gray-600 hover:text-[#7047EB] rounded-full hover:bg-[#7047EB]/5 transition-all"
                >
                  <Search className="h-4 w-4" />
                  Discover
                </Link>
                <Link
                  href="/map"
                  className="flex items-center gap-1.5 px-4 py-2 text-gray-600 hover:text-[#7047EB] rounded-full hover:bg-[#7047EB]/5 transition-all"
                >
                  <MapPin className="h-4 w-4" />
                  Map
                </Link>
                <Link
                  href="/wrapped"
                  className="flex items-center gap-1.5 px-4 py-2 text-[#7047EB] hover:text-[#5a35d4] rounded-full hover:bg-[#7047EB]/10 transition-all"
                >
                  <Sparkles className="h-4 w-4" />
                  Wrapped
                </Link>
              </div>
            )}
          </div>

          {/* Search bar - Desktop */}
          <div className="hidden md:flex flex-1 items-center justify-center max-w-lg mx-8">
            <form action="/search" className="w-full">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="search"
                  name="q"
                  placeholder="Search books, authors..."
                  className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-full bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#7047EB] focus:border-[#7047EB] focus:bg-white transition-all"
                />
              </div>
            </form>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {isLoading ? (
              <div className="h-10 w-10 rounded-full bg-gray-200 animate-pulse" />
            ) : isAuthenticated ? (
              <>
                {/* Profile dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setIsProfileOpen(!isProfileOpen)}
                    className="flex items-center gap-2 p-1 rounded-full hover:ring-2 hover:ring-[#7047EB]/20 transition-all"
                  >
                    <Avatar
                      src={session.user.image}
                      name={session.user.name || "User"}
                      size="sm"
                    />
                  </button>

                  {isProfileOpen && (
                    <>
                      <div
                        className="fixed inset-0"
                        onClick={() => setIsProfileOpen(false)}
                      />
                      <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-lg border border-gray-100 py-2 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-100">
                          <p className="font-medium truncate text-gray-900">
                            {session.user.name}
                          </p>
                          <p className="text-sm text-gray-500 truncate">
                            {session.user.email}
                          </p>
                        </div>
                        <div className="py-1">
                          <Link
                            href={`/user/${session.user.id}`}
                            className="flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
                            onClick={() => setIsProfileOpen(false)}
                          >
                            <User className="h-4 w-4 text-gray-400" />
                            Profile
                          </Link>
                          <Link
                            href="/settings"
                            className="flex items-center gap-3 px-4 py-2.5 text-gray-700 hover:bg-gray-50 transition-colors"
                            onClick={() => setIsProfileOpen(false)}
                          >
                            <Settings className="h-4 w-4 text-gray-400" />
                            Settings
                          </Link>
                          <Link
                            href="/wrapped"
                            className="flex items-center gap-3 px-4 py-2.5 text-[#7047EB] hover:bg-[#7047EB]/5 transition-colors"
                            onClick={() => setIsProfileOpen(false)}
                          >
                            <Sparkles className="h-4 w-4" />
                            Your Wrapped
                          </Link>
                        </div>
                        <div className="border-t border-gray-100 pt-1">
                          <button
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            className="flex items-center gap-3 w-full px-4 py-2.5 text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <LogOut className="h-4 w-4" />
                            Sign Out
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Mobile menu button */}
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="md:hidden p-2 rounded-full hover:bg-gray-100 transition-colors"
                >
                  {isMenuOpen ? (
                    <X className="h-6 w-6" />
                  ) : (
                    <Menu className="h-6 w-6" />
                  )}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login">
                  <Button variant="ghost" size="sm">
                    Sign In
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm">Sign Up</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {isMenuOpen && isAuthenticated && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <div className="px-4 py-4">
            <form action="/search" className="mb-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="search"
                  name="q"
                  placeholder="Search books..."
                  className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-full bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#7047EB]"
                />
              </div>
            </form>
            <div className="space-y-1">
              <Link
                href="/"
                className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:text-[#7047EB] rounded-xl hover:bg-[#7047EB]/5 transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <Home className="h-5 w-5" />
                Home
              </Link>
              <Link
                href="/my-books"
                className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:text-[#7047EB] rounded-xl hover:bg-[#7047EB]/5 transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <BookMarked className="h-5 w-5" />
                My Books
              </Link>
              <Link
                href="/search"
                className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:text-[#7047EB] rounded-xl hover:bg-[#7047EB]/5 transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <Search className="h-5 w-5" />
                Discover
              </Link>
              <Link
                href="/map"
                className="flex items-center gap-3 px-4 py-3 text-gray-700 hover:text-[#7047EB] rounded-xl hover:bg-[#7047EB]/5 transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <MapPin className="h-5 w-5" />
                Map
              </Link>
              <Link
                href="/wrapped"
                className="flex items-center gap-3 px-4 py-3 text-[#7047EB] hover:bg-[#7047EB]/5 rounded-xl transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <Sparkles className="h-5 w-5" />
                Your Wrapped
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
