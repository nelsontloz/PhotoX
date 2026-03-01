"use client";

import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchCurrentUser, formatApiError, loginUser, registerUser } from "../../lib/api";
import { readSession, writeSession } from "../../lib/session";
import { AuthCard, AuthBrandHeader } from "../components/AuthCard";
import { FormInput, PasswordInput } from "../components/FormInput";
import { FormError } from "../components/FormError";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");

  const registerMutation = useMutation({
    mutationFn: async (payload) => {
      await registerUser(payload);
      return loginUser({
        email: payload.email,
        password: payload.password
      });
    },
    onSuccess: (authPayload) => {
      writeSession(authPayload);
      router.replace("/timeline");
    },
    onError: (error) => {
      setFormError(formatApiError(error));
    }
  });

  const submitDisabled = registerMutation.isPending;

  useEffect(() => {
    let cancelled = false;

    async function validateSessionFromCookie() {
      try {
        const mePayload = await fetchCurrentUser();
        if (!cancelled && mePayload?.user) {
          const current = readSession();
          writeSession({
            accessToken: current?.accessToken || null,
            refreshToken: current?.refreshToken || null,
            expiresIn: current?.expiresIn || 0,
            user: mePayload.user
          });
        }
      } catch {
        // ignore: no existing authenticated cookie session.
      }

      const session = readSession();
      if (session?.accessToken || session?.user) {
        router.replace("/timeline");
      }
    }

    validateSessionFromCookie();

    return () => {
      cancelled = true;
    };
  }, [router]);

  function onSubmit(event) {
    event.preventDefault();
    setFormError("");

    if (password !== confirmPassword) {
      setFormError("Passwords do not match (VALIDATION_ERROR)");
      return;
    }

    registerMutation.mutate({
      email,
      password,
      name: name.trim() || undefined
    });
  }

  return (
    <main className="font-display bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 antialiased min-h-screen flex flex-col justify-center items-center overflow-x-hidden selection:bg-primary selection:text-white">
      <AuthBrandHeader subtitle="Join our self-hosted community. Create your account." />
      <AuthCard
        footerText="Already have an account?"
        footerLinkLabel="Sign in"
        footerLinkIcon="login"
        footerLinkHref="/login"
      >
        <form className="p-8 flex flex-col gap-5" onSubmit={onSubmit}>
          <FormInput
            id="fullname"
            name="fullname"
            label="Full Name"
            type="text"
            placeholder="John Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            icon="person"
          />

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
            placeholder="Create a password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />

          <PasswordInput
            id="confirm-password"
            name="confirmPassword"
            label="Confirm Password"
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />

          <FormError message={formError} />

          <button
            className="flex w-full cursor-pointer mt-2 items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-bold h-11 px-5 transition-transform active:scale-[0.98]"
            type="submit"
            disabled={submitDisabled}
          >
            {submitDisabled ? "Creating account..." : "Create Account"}
          </button>
        </form>
      </AuthCard>
    </main>
  );
}
