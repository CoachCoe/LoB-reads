import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
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
  // `parseInt("abc")` is NaN, which became `new Date(NaN, 0, 1)` — an Invalid
  // Date passed straight into a Prisma gte/lte, answering 500.
  const thisYear = new Date().getFullYear();
  const requested = Number(params.year);
  const year =
    Number.isInteger(requested) && requested >= 1900 && requested <= thisYear
      ? requested
      : thisYear;
  const stats = await getWrappedStats(user.id, year);

  return <WrappedExperience stats={stats} userName={user.name || "Reader"} />;
}
