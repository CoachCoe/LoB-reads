import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import {
  getMappedWorkLocations,
  getMappedAuthorLocations,
} from "@/server/map";
import { getAllFictionalWorlds } from "@/server/fictional-worlds";
import MapClient from "./MapClient";

export default async function MapPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/map");
  }

  const [workLocations, authorLocations, fictionalWorlds] = await Promise.all([
    getMappedWorkLocations(),
    getMappedAuthorLocations(),
    getAllFictionalWorlds(),
  ]);

  return (
    <MapClient
      workLocations={workLocations}
      authorLocations={authorLocations}
      initialFictionalWorlds={fictionalWorlds}
      currentUserId={user.id}
      canModerate={user.isModerator}
    />
  );
}
