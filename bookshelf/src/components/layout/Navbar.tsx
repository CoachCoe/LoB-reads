"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import {
  BookOpen,
  Search,
  Menu,
  X,
  LogOut,
  User,
  BookMarked,
  Home,
  Sparkles,
  Settings,
  MapPin,
  Sun,
  Moon,
} from "lucide-react";
import Avatar from "@/components/ui/Avatar";
import Button from "@/components/ui/Button";
import { useTheme } from "@/components/providers/ThemeProvider";

export default function Navbar() {
  const { data: session, status } = useSession();
  const { theme, toggleTheme } = useTheme();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const isLoading = status === "loading";
  const isAuthenticated = status === "authenticated";

  return (
    <nav className="bg-[var(--card-bg)]/80 backdrop-blur-nav border-b border-[var(--border)] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-14">
          {/* Logo and main nav */}
          <div className="flex items-center">
            <Link
              href="/"
              className="flex items-center gap-2 text-[#7047EB] hover:opacity-80 transition-opacity"
            >
              <BookOpen className="h-7 w-7" />
              <span className="text-lg font-semibold hidden sm:block">
                Life on Books
              </span>
            </Link>

            {/* Desktop nav links */}
            {isAuthenticated && (
              <div className="hidden md:flex ml-8 space-x-1">
                <Link
                  href="/"
                  className="flex items-center gap-1.5 px-4 py-2 text-[var(--foreground-secondary)] hover:text-[var(--foreground)] rounded-full hover:bg-[var(--border-light)] transition-all text-sm font-medium"
                >
                  <Home className="h-4 w-4" />
                  Home
                </Link>
                <Link
                  href="/my-books"
                  className="flex items-center gap-1.5 px-4 py-2 text-[var(--foreground-secondary)] hover:text-[var(--foreground)] rounded-full hover:bg-[var(--border-light)] transition-all text-sm font-medium"
                >
                  <BookMarked className="h-4 w-4" />
                  My Books
                </Link>
                <Link
                  href="/search"
                  className="flex items-center gap-1.5 px-4 py-2 text-[var(--foreground-secondary)] hover:text-[var(--foreground)] rounded-full hover:bg-[var(--border-light)] transition-all text-sm font-medium"
                >
                  <Search className="h-4 w-4" />
                  Discover
                </Link>
                <Link
                  href="/map"
                  className="flex items-center gap-1.5 px-4 py-2 text-[var(--foreground-secondary)] hover:text-[var(--foreground)] rounded-full hover:bg-[var(--border-light)] transition-all text-sm font-medium"
                >
                  <MapPin className="h-4 w-4" />
                  Map
                </Link>
                <Link
                  href="/wrapped"
                  className="flex items-center gap-1.5 px-4 py-2 text-[#7047EB] hover:bg-[#7047EB]/10 rounded-full transition-all text-sm font-medium"
                >
                  <Sparkles className="h-4 w-4" />
                  Wrapped
                </Link>
              </div>
            )}
          </div>

          {/* Search bar - Desktop */}
          <div className="hidden md:flex flex-1 items-center justify-center max-w-md mx-6">
            <form action="/search" className="w-full">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--foreground-secondary)]" />
                <input
                  type="search"
                  name="q"
                  placeholder="Search books, authors..."
                  className="w-full pl-10 pr-4 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-full text-[var(--foreground)] placeholder-[var(--foreground-secondary)] focus:outline-none focus:ring-2 focus:ring-[#7047EB] focus:border-transparent transition-all text-sm"
                />
              </div>
            </form>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-[var(--border-light)] transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-5 w-5 text-[var(--foreground-secondary)]" />
              ) : (
                <Moon className="h-5 w-5 text-[var(--foreground-secondary)]" />
              )}
            </button>

            {isLoading ? (
              <div className="h-9 w-9 rounded-full bg-[var(--border)] animate-pulse" />
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
                      <div className="absolute right-0 mt-2 w-56 bg-[var(--card-bg)] rounded-xl shadow-lg border border-[var(--card-border)] py-2 overflow-hidden">
                        <div className="px-4 py-3 border-b border-[var(--border)]">
                          <p className="font-medium truncate text-[var(--foreground)]">
                            {session.user.name}
                          </p>
                          <p className="text-sm text-[var(--foreground-secondary)] truncate">
                            {session.user.email}
                          </p>
                        </div>
                        <div className="py-1">
                          <Link
                            href={`/user/${session.user.id}`}
                            className="flex items-center gap-3 px-4 py-2.5 text-[var(--foreground)] hover:bg-[var(--border-light)] transition-colors"
                            onClick={() => setIsProfileOpen(false)}
                          >
                            <User className="h-4 w-4 text-[var(--foreground-secondary)]" />
                            Profile
                          </Link>
                          <Link
                            href="/settings"
                            className="flex items-center gap-3 px-4 py-2.5 text-[var(--foreground)] hover:bg-[var(--border-light)] transition-colors"
                            onClick={() => setIsProfileOpen(false)}
                          >
                            <Settings className="h-4 w-4 text-[var(--foreground-secondary)]" />
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
                        <div className="border-t border-[var(--border)] pt-1">
                          <button
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            className="flex items-center gap-3 w-full px-4 py-2.5 text-red-500 hover:bg-red-500/10 transition-colors"
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
                  className="md:hidden p-2 rounded-full hover:bg-[var(--border-light)] transition-colors"
                >
                  {isMenuOpen ? (
                    <X className="h-5 w-5 text-[var(--foreground)]" />
                  ) : (
                    <Menu className="h-5 w-5 text-[var(--foreground)]" />
                  )}
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
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
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--card-bg)]">
          <div className="px-4 py-4">
            <form action="/search" className="mb-4">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--foreground-secondary)]" />
                <input
                  type="search"
                  name="q"
                  placeholder="Search books..."
                  className="w-full pl-10 pr-4 py-2.5 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-full text-[var(--foreground)] placeholder-[var(--foreground-secondary)] focus:outline-none focus:ring-2 focus:ring-[#7047EB]"
                />
              </div>
            </form>
            <div className="space-y-1">
              <Link
                href="/"
                className="flex items-center gap-3 px-4 py-3 text-[var(--foreground)] hover:bg-[var(--border-light)] rounded-xl transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <Home className="h-5 w-5" />
                Home
              </Link>
              <Link
                href="/my-books"
                className="flex items-center gap-3 px-4 py-3 text-[var(--foreground)] hover:bg-[var(--border-light)] rounded-xl transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <BookMarked className="h-5 w-5" />
                My Books
              </Link>
              <Link
                href="/search"
                className="flex items-center gap-3 px-4 py-3 text-[var(--foreground)] hover:bg-[var(--border-light)] rounded-xl transition-all"
                onClick={() => setIsMenuOpen(false)}
              >
                <Search className="h-5 w-5" />
                Discover
              </Link>
              <Link
                href="/map"
                className="flex items-center gap-3 px-4 py-3 text-[var(--foreground)] hover:bg-[var(--border-light)] rounded-xl transition-all"
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
