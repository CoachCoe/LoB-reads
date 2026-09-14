import { requireUser } from "@/lib/auth/session";
import { getWrappedProjections } from "@/server/wrapped";
import ProjectionsView from "./ProjectionsView";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reading projections",
  robots: { index: false, follow: false },
};


export default async function ProjectionsPage() {
  const user = await requireUser("/wrapped/projections");

  const projections = await getWrappedProjections(user.id);

  return <ProjectionsView projections={projections} userName={user.name || "Reader"} />;
}
