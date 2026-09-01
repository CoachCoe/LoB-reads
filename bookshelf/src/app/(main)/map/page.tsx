import { getCurrentUser } from "@/lib/auth/session";
import {
  getMappedWorkLocations,
  getMappedAuthorLocations,
} from "@/server/map";
import { getAllFictionalWorlds } from "@/server/fictional-worlds";
import MapClient from "./MapClient";

/**
 * Public. The map shows only community-contributed locations, and MapClient
 * already takes a null user — `currentUserId` is typed `string | null` and
 * FictionalWorldsPanel documents its own null case. The redirect that used to
 * be here was gratuitous, and it made PRD R6 ("a reader with no account has no
 * route to the map") an understatement: there was not a buried route, there was
 * a login wall.
 */
export default async function MapPage() {
  const user = await getCurrentUser();

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
      currentUserId={user?.id ?? null}
      canModerate={Boolean(user?.isModerator)}
    />
  );
}
