"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { formatApiError, loginUser } from "../../lib/api";
import { resolveNextPath } from "../../lib/navigation";
import { readSession, writeSession } from "../../lib/session";
import { AuthCard, AuthBrandHeader } from "../components/AuthCard";
import { FormInput, PasswordInput } from "../components/FormInput";
import { FormError } from "../components/FormError";

export default function LoginPage() {
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/timeline");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const session = readSession();
    if (session?.accessToken) {
      router.replace("/timeline");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setNextPath(resolveNextPath(params.get("next")));
  }, [router]);

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
    loginMutation.mutate({ email, password });
  }

  return (
    <main className="font-display bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 antialiased min-h-screen flex flex-col justify-center items-center overflow-x-hidden selection:bg-primary selection:text-white">
      <AuthBrandHeader subtitle="Welcome back, please sign in to your account." />
      <AuthCard
        footerText="Don't have an account?"
        footerLinkLabel="Create an account"
        footerLinkIcon="arrow_forward"
        footerLinkHref="/register"
      >
        <form className="p-8 flex flex-col gap-6" onSubmit={onSubmit}>
          <FormInput
            id="email"
            name="email"
            label="Email address"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            icon="mail"
          />

          <PasswordInput
            id="password"
            name="password"
            label="Password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            labelRightSlot={
              <Link className="text-xs font-medium text-primary hover:text-primary/80 transition-colors" href="#">
                Forgot password?
              </Link>
            }
          />

          <FormError message={formError} />

          <button
            className="flex w-full cursor-pointer items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-bold h-11 px-5 transition-transform active:scale-[0.98]"
            type="submit"
            disabled={submitDisabled}
          >
            {submitDisabled ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </AuthCard>
    </main>
  );
}
