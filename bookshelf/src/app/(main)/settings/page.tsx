import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import prisma from "@/lib/prisma";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage() {
  const sessionUser = await getCurrentUser();

  if (!sessionUser) {
    redirect("/login?callbackUrl=/settings");
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: {
      id: true,
      name: true,
      email: true,
      bio: true,
      avatarUrl: true,
    },
  });

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Settings</h1>
      <SettingsForm user={user} />
    </div>
  );
}
