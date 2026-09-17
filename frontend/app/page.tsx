"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

/** Root: route to the dashboard or the login page depending on session. */
export default function Root() {
  const { session, loading } = useSession();
  const router = useRouter();
  useEffect(() => { if (!loading) router.replace(session ? "/dashboard/" : "/login/"); }, [session, loading, router]);
  return null;
}
