"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { formatApiError, loginUser, registerUser } from "../../lib/api";
import { readSession, writeSession } from "../../lib/session";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
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
    const session = readSession();
    if (session?.accessToken) {
      router.replace("/timeline");
    }
  }, [router]);

  function onSubmit(event) {
    event.preventDefault();
    setFormError("");

    if (password !== confirmPassword) {
      setFormError("Passwords do not match (VALIDATION_ERROR)");
      return;
    }

    if (!agreeToTerms) {
      setFormError("You must accept Terms of Service and Privacy Policy (VALIDATION_ERROR)");
      return;
    }

    registerMutation.mutate({
      email,
      password,
      name: name.trim() || undefined
    });
  }

  return (
    <main className="relative isolate flex min-h-[calc(100vh-61px)] items-center justify-center overflow-hidden px-4 py-8 sm:py-12">
      <div className="absolute inset-0 -z-10">
        <div
          className="h-full w-full scale-105 bg-cover bg-center blur-md"
          style={{
            backgroundImage:
              "url('https://lh3.googleusercontent.com/aida-public/AB6AXuBP75H4ImlxeUwpr5N8KA_B6RztUJz7JFe1UB7mvbs4y6mRhYloFsT50vRb0UlGfNH1lpAUsAnT6WDS2rVT-We7BseJJBRXq-4NixnuG3lCXlcq5KSj1A1EBRGBtm6qjotwSIwGjEA7UeO3eZrEAzM7nBlVkwh3mTSjj9dOs6SVsCsUMes8OCD_A7JzhwmAdijR1htrQcjiVEB5u4gtsRvd0_a2bX0iuYMBrH7z3OJj3_oAPWLGDtd5n5eInFGyavPBtK80KBqqxn_I')"
          }}
        />
        <div className="absolute inset-0 bg-[#f6f8f8]/65" />
      </div>

      <section className="w-full max-w-[480px] rounded-2xl border border-white/70 bg-white/85 p-8 shadow-2xl backdrop-blur-md sm:p-10">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-lg bg-[#13b6ec] text-xl font-black text-white shadow-lg shadow-cyan-500/30">
            P
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#0d181b]">Join PhotoX</h1>
          <p className="text-sm font-medium text-[#4c869a]">Start your self-hosted photography journey today.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-[#0d181b]">Full Name</span>
            <input
              className="w-full rounded-lg border border-[#cfe1e7] bg-white/70 px-4 py-3 text-[#0d181b] outline-none ring-[#13b6ec] transition focus:ring-2"
              type="text"
              name="name"
              placeholder="John Doe"
              value={name}
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-[#0d181b]">Email Address</span>
            <input
              className="w-full rounded-lg border border-[#cfe1e7] bg-white/70 px-4 py-3 text-[#0d181b] outline-none ring-[#13b6ec] transition focus:ring-2"
              type="email"
              name="email"
              placeholder="user@photox.com"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-[#0d181b]">Password</span>
            <div className="relative">
              <input
                className="w-full rounded-lg border border-[#cfe1e7] bg-white/70 px-4 py-3 pr-12 text-[#0d181b] outline-none ring-[#13b6ec] transition focus:ring-2"
                type={showPassword ? "text" : "password"}
                name="password"
                placeholder="••••••••"
                value={password}
                autoComplete="new-password"
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-bold uppercase tracking-wide text-[#4c869a]"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <div className="mt-2 flex gap-1">
              <div className="h-1 flex-1 rounded bg-[#13b6ec]" />
              <div className="h-1 flex-1 rounded bg-[#13b6ec]" />
              <div className="h-1 flex-1 rounded bg-[#13b6ec]" />
              <div className="h-1 flex-1 rounded bg-gray-200" />
            </div>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#4c869a]">Strong Password</p>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-bold text-[#0d181b]">Confirm Password</span>
            <div className="relative">
              <input
                className="w-full rounded-lg border border-[#cfe1e7] bg-white/70 px-4 py-3 pr-12 text-[#0d181b] outline-none ring-[#13b6ec] transition focus:ring-2"
                type={showConfirmPassword ? "text" : "password"}
                name="confirmPassword"
                placeholder="••••••••"
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((current) => !current)}
                className="absolute inset-y-0 right-0 px-3 text-xs font-bold uppercase tracking-wide text-[#4c869a]"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label className="flex items-start gap-2 py-1">
            <input
              className="mt-1 h-4 w-4 rounded border-gray-300 text-[#13b6ec] focus:ring-[#13b6ec]"
              type="checkbox"
              name="terms"
              checked={agreeToTerms}
              onChange={(event) => setAgreeToTerms(event.target.checked)}
              required
            />
            <span className="text-xs font-medium leading-relaxed text-[#4c869a]">
              I agree to the <span className="font-bold text-[#13b6ec]">Terms of Service</span> and{" "}
              <span className="font-bold text-[#13b6ec]">Privacy Policy</span>.
            </span>
          </label>

          {formError ? <p className="error">{formError}</p> : null}

          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#13b6ec] px-4 py-3 font-bold text-white shadow-lg shadow-cyan-500/25 transition hover:bg-[#11a3d4]"
            disabled={submitDisabled}
          >
            {submitDisabled ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px flex-1 bg-[#cfe1e7]" />
          <span className="text-xs font-medium text-[#4c869a]">Already have an account?</span>
          <div className="h-px flex-1 bg-[#cfe1e7]" />
        </div>

        <Link
          href="/login"
          className="inline-flex w-full items-center justify-center rounded-lg border border-[#cfe1e7] bg-white/60 px-4 py-2.5 text-sm font-bold text-[#0d181b] transition hover:bg-gray-50"
        >
          Sign In
        </Link>
      </section>
    </main>
  );
}
