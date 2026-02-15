"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { formatApiError, loginUser, registerUser } from "../../lib/api";
import { writeSession } from "../../lib/session";

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
      router.replace("/upload");
    },
    onError: (error) => {
      setFormError(formatApiError(error));
    }
  });

  const submitDisabled = registerMutation.isPending;

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
    <main className="shell py-10">
      <section className="panel mx-auto max-w-xl p-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-ocean-900">Create account</h1>
        <p className="mt-2 text-sm text-ocean-700">Set up your profile and jump directly into uploads.</p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ocean-800">Name (optional)</span>
            <input
              className="field"
              type="text"
              name="name"
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

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
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ocean-800">Confirm password</span>
            <input
              className="field"
              type="password"
              name="confirmPassword"
              value={confirmPassword}
              autoComplete="new-password"
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>

          {formError ? <p className="error">{formError}</p> : null}

          <button type="submit" className="btn btn-primary w-full" disabled={submitDisabled}>
            {submitDisabled ? "Creating account..." : "Create account"}
          </button>
        </form>

        <p className="mt-5 text-sm text-ocean-700">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-ocean-900 underline underline-offset-4">
            Sign in
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
