"use client";

import { useState } from "react";
import { UserPlus, UserMinus } from "lucide-react";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/providers/ToastProvider";

interface FollowButtonProps {
  userId: string;
  initialFollowing: boolean;
}

export default function FollowButton({
  userId,
  initialFollowing,
}: FollowButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialFollowing);
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  const handleToggleFollow = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/users/${userId}/follow`, {
        method: isFollowing ? "DELETE" : "POST",
      });

      if (!response.ok) {
        // Both server functions used bare create/delete, so a duplicate follow
        // or a stale unfollow arrived here as a 500 that this handler discarded
        // — the button simply refused to change state with no explanation.
        // errorResponse now maps those to 409/404; this makes them visible.
        const data = await response.json().catch(() => ({}));
        showToast(data.error ?? "Could not update who you follow", "error");
        return;
      }

      setIsFollowing(!isFollowing);
    } catch {
      showToast("Could not reach the server. Try again.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      onClick={handleToggleFollow}
      variant={isFollowing ? "outline" : "primary"}
      isLoading={isLoading}
      className="flex items-center gap-2"
    >
      {isFollowing ? (
        <>
          <UserMinus className="h-4 w-4" />
          Unfollow
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4" />
          Follow
        </>
      )}
    </Button>
  );
}
