"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { formatApiError, loginUser } from "../../lib/api";
import { resolveNextPath } from "../../lib/navigation";
import { writeSession } from "../../lib/session";

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/upload");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(resolveNextPath(params.get("next")));
  }, []);

  const loginMutation = useMutation({
    mutationFn: (payload) => loginUser(payload),
    onSuccess: (authPayload) => {
      writeSession(authPayload);
      router.replace(nextPath);
    },
    onError: (error) => {
      setFormError(formatApiError(error));
    }
  });

  const submitDisabled = loginMutation.isPending;

  function onSubmit(event) {
    event.preventDefault();
    setFormError("");

    loginMutation.mutate({
      email,
      password
    });
  }

  return (
    <main className="shell py-10">
      <section className="panel mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ocean-900">Sign in</h1>
        <p className="mt-2 text-sm text-ocean-700">Use your PhotoX account to access upload features.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ocean-800">Email</span>
            <input
              className="field"
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ocean-800">Password</span>
            <input
              className="field"
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {formError ? <p className="error">{formError}</p> : null}

          <button type="submit" className="btn btn-primary w-full" disabled={submitDisabled}>
            {submitDisabled ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-5 text-sm text-ocean-700">
          New to PhotoX?{" "}
          <Link href="/register" className="font-semibold text-ocean-900 underline underline-offset-4">
            Create an account
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
