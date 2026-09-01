"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Card, { CardContent, CardHeader } from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import Avatar from "@/components/ui/Avatar";
import { Upload, FileUp, CheckCircle, AlertCircle } from "lucide-react";

interface User {
  id: string;
  name: string;
  email: string;
  bio: string | null;
  avatarUrl: string | null;
}

interface SettingsFormProps {
  user: User;
}

interface ImportResultState {
  sessionId: string;
  totalRows: number;
  matched: number;
  needsReview: number;
  matchRate: number;
  notProcessed: number;
  maxRows: number;
}

export default function SettingsForm({ user }: SettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || "");
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [message, setMessage] = useState("");
  // Tracked rather than inferred from the text. The banner used to decide its
  // colour with `message.includes("success")`, so "Imported 12 books." — a
  // success — rendered red.
  const [messageVariant, setMessageVariant] = useState<"success" | "error">(
    "error"
  );

  const reportSuccess = (text: string) => {
    setMessageVariant("success");
    setMessage(text);
  };

  const reportError = (text: string) => {
    setMessageVariant("error");
    setMessage(text);
  };
  const [importResult, setImportResult] = useState<ImportResultState | null>(
    null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage("");

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          bio,
          // An empty field means "remove my avatar". Sent as "" it reached
          // z.url(), which rejects it, so clearing the avatar returned
          // 400 "avatarUrl: Invalid URL" and discarded the bio edit with it —
          // and the schema's .nullable() branch, the only way to clear the
          // column, was unreachable from any UI. FLOW-21.
          avatarUrl: avatarUrl.trim() || null,
        }),
      });

      if (response.ok) {
        reportSuccess("Settings saved successfully!");
        router.refresh();
      } else {
        const data = await response.json();
        reportError(data.error || "Failed to save settings");
      }
    } catch {
      reportError("An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const generateRandomAvatar = () => {
    const seed = Math.random().toString(36).substring(7);
    setAvatarUrl(`https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`);
  };

  const handleAvatarUpload = async (file: File) => {
    setIsUploadingAvatar(true);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/users/${user.id}/avatar`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setAvatarUrl(data.url);
        reportSuccess("Avatar uploaded successfully!");
        router.refresh();
      } else {
        const error = await response.json();
        reportError(error.error || "Failed to upload avatar");
      }
    } catch (error) {
      console.error("Upload error:", error);
      reportError("Failed to upload avatar");
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleGoodreadsImport = async (file: File) => {
    setIsImporting(true);
    setImportResult(null);
    setMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/import/goodreads", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setImportResult({
          sessionId: data.sessionId,
          totalRows: data.summary.totalRows,
          matched: data.summary.matched,
          needsReview: data.summary.needsReview,
          matchRate: data.summary.matchRate,
          notProcessed: data.notProcessed,
          maxRows: data.maxRows,
        });
        reportSuccess(`Imported ${data.summary.matched} books.`);
        router.refresh();
      } else {
        reportError(data.error || "Failed to import Goodreads library");
      }
    } catch (error) {
      console.error("Import error:", error);
      reportError("Failed to import Goodreads library");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">Profile Information</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Avatar */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Avatar
              </label>
              <div className="flex items-center gap-4">
                <Avatar
                  src={avatarUrl || user.avatarUrl}
                  name={name}
                  size="xl"
                />
                <div className="space-y-2">
                  {/* Upload Button */}
                  <label className="flex items-center gap-2 px-4 py-2 bg-[#D4A017] text-[var(--color-primary-contrast)] rounded-full hover:bg-[#B8860B] transition-colors cursor-pointer text-sm font-medium">
                    <Upload className="h-4 w-4" />
                    {isUploadingAvatar ? "Uploading..." : "Upload Photo"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp"
                      className="hidden"
                      disabled={isUploadingAvatar}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleAvatarUpload(file);
                        }
                      }}
                    />
                  </label>

                  {/* Generate Random Avatar Button */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={generateRandomAvatar}
                    disabled={isUploadingAvatar}
                  >
                    Generate Random Avatar
                  </Button>

                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Or paste a custom URL below
                  </p>
                </div>
              </div>
            </div>

            <Input
              label="Avatar URL"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.jpg"
            />

            <Input
              label="Name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Email
              </label>
              <p className="text-gray-500 dark:text-gray-400">{user.email}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Email cannot be changed
              </p>
            </div>

            <Textarea
              label="Bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell other readers about yourself..."
              rows={4}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" isLoading={isLoading}>
            Save Changes
          </Button>
        </div>
      </form>

      {/* Goodreads Import */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Import from Goodreads</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Export your Goodreads library as a CSV file and import it here. Your
            books, ratings, shelves, and reading dates will be imported.
          </p>

          <div className="space-y-2">
            <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-[#D4A017] transition-colors cursor-pointer">
              <FileUp className="h-5 w-5 text-gray-400 dark:text-gray-500" />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {isImporting ? "Importing..." : "Choose CSV file"}
              </span>
              <input
                type="file"
                accept=".csv"
                className="hidden"
                disabled={isImporting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleGoodreadsImport(file);
                  }
                }}
              />
            </label>

            <p className="text-xs text-gray-400 dark:text-gray-500">
              To export from Goodreads: My Books → Import and Export → Export
              Library
            </p>
          </div>

          {importResult && (
            <div className="space-y-3 rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle className="h-4 w-4" aria-hidden="true" />
                  {importResult.matched} of {importResult.totalRows} matched (
                  {importResult.matchRate}%)
                </span>
                {importResult.needsReview > 0 && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {importResult.needsReview} need a look
                  </span>
                )}
              </div>

              {importResult.needsReview > 0 && (
                <>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    These are kept, not discarded — most are a spelling
                    difference between your export and our catalog.
                  </p>
                  <Link
                    href={`/import/${importResult.sessionId}`}
                    className="inline-block rounded-lg bg-[#D4A017] px-4 py-2 text-sm font-medium text-[var(--color-primary-contrast)] hover:bg-[#B8860B]"
                  >
                    Review {importResult.needsReview}{" "}
                    {importResult.needsReview === 1 ? "book" : "books"}
                  </Link>
                </>
              )}

              {importResult.notProcessed > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  The first {importResult.maxRows} rows were read.{" "}
                  {importResult.notProcessed} more are still in the file —
                  upload it again to continue where this left off.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {message && (
        <div
          // Was `message.includes("success")`, so "Imported 12 books." — set on
          // the success path — rendered in the error style. The variant is now
          // tracked alongside the message instead of being guessed from it.
          className={`p-3 rounded-lg text-sm ${
            messageVariant === "success"
              ? "bg-green-50 text-green-600"
              : "bg-red-50 text-red-600"
          }`}
        >
          {message}
        </div>
      )}
    </div>
  );
}
