import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getWrappedStats } from "@/server/wrapped";
import WrappedExperience from "./WrappedExperience";

interface Props {
  searchParams: Promise<{ year?: string }>;
}

export default async function WrappedPage({ searchParams }: Props) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/wrapped");
  }

  const params = await searchParams;
  const year = params.year ? parseInt(params.year) : new Date().getFullYear();
  const stats = await getWrappedStats(user.id, year);

  return <WrappedExperience stats={stats} userName={user.name || "Reader"} />;
}
