import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooksWithLocations } from "@/server/map";
import { getAllFictionalWorlds } from "@/server/fictional-worlds";
import MapClient from "./MapClient";

export default async function MapPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/map");
  }

  const [books, fictionalWorlds] = await Promise.all([
    getBooksWithLocations(),
    getAllFictionalWorlds(),
  ]);

  return <MapClient books={books} initialFictionalWorlds={fictionalWorlds} />;
}
