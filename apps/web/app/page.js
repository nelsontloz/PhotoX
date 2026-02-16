"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { readSession } from "../lib/session";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const session = readSession();
    if (session?.accessToken) {
      router.replace("/timeline");
      return;
    }

    router.replace("/login");
  }, [router]);

  return (
    <main className="shell py-10">
      <section className="panel p-8">
        <p className="text-sm text-ocean-700">Redirecting...</p>
      </section>
    </main>
  );
}
