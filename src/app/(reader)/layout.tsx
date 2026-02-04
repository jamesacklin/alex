import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";

export default async function ReaderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {children}
    </div>
  );
}
