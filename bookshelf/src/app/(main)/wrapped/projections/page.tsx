import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getWrappedProjections } from "@/server/wrapped";
import ProjectionsView from "./ProjectionsView";

export default async function ProjectionsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login?callbackUrl=/wrapped/projections");
  }

  const projections = await getWrappedProjections(user.id);

  return <ProjectionsView projections={projections} userName={user.name || "Reader"} />;
}
