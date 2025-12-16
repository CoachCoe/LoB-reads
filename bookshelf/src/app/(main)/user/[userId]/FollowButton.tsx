"use client";

import { useState } from "react";
import { UserPlus, UserMinus } from "lucide-react";
import Button from "@/components/ui/Button";

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

  const handleToggleFollow = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/users/${userId}/follow`, {
        method: isFollowing ? "DELETE" : "POST",
      });

      if (response.ok) {
        setIsFollowing(!isFollowing);
      }
    } catch (error) {
      console.error("Failed to toggle follow:", error);
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
