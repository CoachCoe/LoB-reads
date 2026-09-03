import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getWrappedStats } from "@/server/wrapped";
import { resolveWrappedYear } from "@/lib/wrapped-year";
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
  // Clamped in resolveWrappedYear, which carries the reasoning and the tests.
  const stats = await getWrappedStats(user.id, resolveWrappedYear(params.year));

  return <WrappedExperience stats={stats} userName={user.name || "Reader"} />;
}
