import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { FaRegUser, FaRegEnvelope, FaLock, FaArrowRight } from 'react-icons/fa6';
import { useAuthStore } from '../../store/auth-store';
import { AuthError, AuthField, AuthShell, AuthSubmit } from '../../components/AuthShell';
import { getRegistrationSettings } from '../../api/auth';
import { useAsyncFetch } from '../../hooks/useAsyncFetch';

const SIGNUPS_DISABLED = 'Public sign-ups are disabled. Ask an administrator for an account.';

export default function RegisterPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { register, status, error, clearError } = useAuthStore();
  const authenticated = status === 'authenticated';

  // The form renders while the check is in flight; only a confirmed `false` replaces it. A
  // failed check also falls back to the form: the register call still refuses with a 403.
  const { data: registration } = useAsyncFetch(getRegistrationSettings, {
    errorMessage: 'Failed to check whether sign-ups are open',
  });
  const signupsClosed = registration?.enabled === false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    await register(email, password, fullName);
    if (useAuthStore.getState().status === 'authenticated') {
      void navigate('/');
    }
  };

  if (authenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthShell
      subtitle={
        signupsClosed ? 'Sign-ups are currently closed.' : 'Create your account to get started.'
      }
      footer={
        signupsClosed ? (
          <>Accounts on this instance are created by an administrator.</>
        ) : (
          <>
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1 transition-colors"
            >
              Sign in
              <FaArrowRight className="text-[12px] font-bold" />
            </Link>
          </>
        )
      }
    >
      {signupsClosed ? (
        <div className="p-8 flex flex-col gap-6">
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#151b23] px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300"
          >
            <FaLock className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span>{SIGNUPS_DISABLED}</span>
          </p>
          <Link
            to="/login"
            className="flex w-full items-center justify-center rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-bold h-11 px-5 transition-transform active:scale-[0.98]"
          >
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} className="p-8 flex flex-col gap-6">
          <AuthField
            id="fullName"
            label="Full name"
            icon={FaRegUser}
            value={fullName}
            onChange={setFullName}
            placeholder="John Doe"
          />

          <AuthField
            id="email"
            label="Email address"
            type="email"
            icon={FaRegEnvelope}
            value={email}
            onChange={setEmail}
            placeholder="name@example.com"
          />

          <AuthField
            id="password"
            label="Password"
            icon={FaLock}
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((v) => !v)}
          />

          <AuthField
            id="confirmPassword"
            label="Confirm password"
            icon={FaLock}
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Confirm your password"
            showPassword={showConfirmPassword}
            onTogglePassword={() => setShowConfirmPassword((v) => !v)}
          />

          <AuthError message={passwordError ?? error} onClear={clearError} />

          <AuthSubmit loading={status === 'loading'} label="Create Account" />
        </form>
      )}
    </AuthShell>
  );
}
