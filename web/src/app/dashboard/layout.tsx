"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hydrateToken, getToken } from "@/lib/api";
import Sidebar from "./sidebar";
import Header from "./header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    hydrateToken();                                  // 1. install persisted token
    if (!getToken()) { router.replace("/login"); return; }   // 2. no session -> login
    setReady(true);                                  // 3. only now render children
  }, [router]);

  useEffect(() => {                                  // 4. any 401 anywhere -> login
    const onLogout = () => router.replace("/login");
    window.addEventListener("ka:logout", onLogout);
    return () => window.removeEventListener("ka:logout", onLogout);
  }, [router]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header authVersion={ready ? 1 : 0} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{ready ? children : null}</main>
      </div>
    </div>
  );
}
