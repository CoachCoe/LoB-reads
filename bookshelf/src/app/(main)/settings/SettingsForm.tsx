"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Card, { CardContent, CardHeader } from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import Button from "@/components/ui/Button";
import Avatar from "@/components/ui/Avatar";

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

export default function SettingsForm({ user }: SettingsFormProps) {
  const router = useRouter();
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || "");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

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

  return (
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
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={generateRandomAvatar}
                >
                  Generate New Avatar
                </Button>
                <p className="text-xs text-gray-500 mt-1">
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

      <div className="flex justify-end">
        <Button type="submit" isLoading={isLoading}>
          Save Changes
        </Button>
      </div>
    </form>
  );
}
