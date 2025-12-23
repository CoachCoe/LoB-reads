"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  imported: number;
  skipped: number;
  errors: string[];
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
        body: JSON.stringify({ name, bio, avatarUrl }),
      });

      if (response.ok) {
        setMessage("Settings saved successfully!");
        router.refresh();
      } else {
        const data = await response.json();
        setMessage(data.error || "Failed to save settings");
      }
    } catch {
      setMessage("An error occurred");
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
        setMessage("Avatar uploaded successfully!");
        router.refresh();
      } else {
        const error = await response.json();
        setMessage(error.error || "Failed to upload avatar");
      }
    } catch (error) {
      console.error("Upload error:", error);
      setMessage("Failed to upload avatar");
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
          imported: data.imported,
          skipped: data.skipped,
          errors: data.errors,
        });
        setMessage(`Successfully imported ${data.imported} books!`);
        router.refresh();
      } else {
        setMessage(data.error || "Failed to import Goodreads library");
      }
    } catch (error) {
      console.error("Import error:", error);
      setMessage("Failed to import Goodreads library");
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
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  <label className="flex items-center gap-2 px-4 py-2 bg-[#D4A017] text-white rounded-full hover:bg-[#B8860B] transition-colors cursor-pointer text-sm font-medium">
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

                  <p className="text-xs text-gray-500">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <p className="text-gray-500">{user.email}</p>
              <p className="text-xs text-gray-400 mt-1">
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
          <p className="text-sm text-gray-600">
            Export your Goodreads library as a CSV file and import it here. Your
            books, ratings, shelves, and reading dates will be imported.
          </p>

          <div className="space-y-2">
            <label className="flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-[#D4A017] transition-colors cursor-pointer">
              <FileUp className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">
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

            <p className="text-xs text-gray-400">
              To export from Goodreads: My Books → Import and Export → Export
              Library
            </p>
          </div>

          {importResult && (
            <div className="p-4 bg-gray-50 rounded-lg space-y-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-600 flex items-center gap-1">
                  <CheckCircle className="h-4 w-4" />
                  {importResult.imported} imported
                </span>
                {importResult.skipped > 0 && (
                  <span className="text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    {importResult.skipped} skipped
                  </span>
                )}
              </div>

              {importResult.errors.length > 0 && (
                <details className="text-xs text-gray-500">
                  <summary className="cursor-pointer">View errors</summary>
                  <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                    {importResult.errors.slice(0, 10).map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                    {importResult.errors.length > 10 && (
                      <li>...and {importResult.errors.length - 10} more</li>
                    )}
                  </ul>
                </details>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {message && (
        <div
          className={`p-3 rounded-lg text-sm ${
            message.includes("success")
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
