import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getBooksWithLocations } from "@/server/map";
import MapClient from "./MapClient";

export default async function MapPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/map");
  }

  const books = await getBooksWithLocations();

  return <MapClient books={books} />;
}
