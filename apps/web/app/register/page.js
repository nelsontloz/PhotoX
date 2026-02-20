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



    registerMutation.mutate({
      email,
      password,
      name: name.trim() || undefined
    });
  }

  return (
    <main className="font-display bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 antialiased min-h-screen flex flex-col justify-center items-center overflow-x-hidden selection:bg-primary selection:text-white">
      <div className="w-full max-w-md p-6">
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/20 text-primary mb-4">
            <span className="material-symbols-outlined text-3xl">photo_library</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white mb-2">PhotoX</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-normal">
            Join our self-hosted community. Create your account.
          </p>
        </div>

        <div className="w-full rounded-xl bg-white dark:bg-[#1c2430] border border-slate-200 dark:border-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-black/20 overflow-hidden">
          <form className="p-8 flex flex-col gap-5" onSubmit={onSubmit}>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="fullname">
                Full Name
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">person</span>
                </div>
                <input
                  className="form-input w-full rounded-lg border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200"
                  id="fullname"
                  name="fullname"
                  placeholder="John Doe"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="email">
                Email address
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">mail</span>
                </div>
                <input
                  className="form-input w-full rounded-lg border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200"
                  id="email"
                  name="email"
                  placeholder="name@example.com"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="password">
                Password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">lock</span>
                </div>
                <input
                  className="form-input w-full rounded-lg border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-10 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200"
                  id="password"
                  name="password"
                  placeholder="Create a password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 focus:outline-none"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <span className="material-symbols-outlined text-[20px]">{showPassword ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300" htmlFor="confirm-password">
                Confirm Password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-primary transition-colors">
                  <span className="material-symbols-outlined text-[20px]">lock_reset</span>
                </div>
                <input
                  className="form-input w-full rounded-lg border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#151b23] text-slate-900 dark:text-white pl-10 pr-4 py-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-slate-400 dark:placeholder:text-slate-600 transition-all duration-200"
                  id="confirm-password"
                  name="confirmPassword"
                  placeholder="Repeat your password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-300 focus:outline-none"
                  type="button"
                  onClick={() => setShowConfirmPassword((current) => !current)}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  <span className="material-symbols-outlined text-[20px]">{showConfirmPassword ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
            </div>



            {formError ? (
              <div className="flex items-center gap-2 text-red-500 text-xs bg-red-500/10 p-2 rounded border border-red-500/20">
                <span className="material-symbols-outlined text-[16px]">error</span>
                <span>{formError}</span>
              </div>
            ) : null}

            <button
              className="flex w-full cursor-pointer mt-2 items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-bold h-11 px-5 transition-transform active:scale-[0.98]"
              type="submit"
              disabled={submitDisabled}
            >
              {submitDisabled ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <div className="px-8 py-5 bg-slate-50 dark:bg-[#151b23] border-t border-slate-200 dark:border-slate-800 text-center">
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Already have an account?{" "}
              <Link className="font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1 transition-colors" href="/login">
                Sign in
                <span className="material-symbols-outlined text-[16px] font-bold">login</span>
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xs text-slate-400 dark:text-slate-600 font-medium">PhotoX v2.4.0</p>
        </div>
      </div>
    </main>
  );
}
