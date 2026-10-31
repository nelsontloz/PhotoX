import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { FaRegEnvelope, FaLock, FaArrowRight } from 'react-icons/fa6';
import { useAuthStore } from '../../store/auth-store';
import { AuthError, AuthField, AuthShell, AuthSubmit } from '../../components/AuthShell';
import { getRegistrationSettings } from '../../api/auth';
import { useAsyncFetch } from '../../hooks/useAsyncFetch';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { login, status, error, clearError } = useAuthStore();
  const authenticated = status === 'authenticated';

  // The link stays while the check is in flight and when it fails — the register page covers
  // direct navigation either way. Only a confirmed `false` hides it.
  const { data: registration } = useAsyncFetch(getRegistrationSettings, {
    errorMessage: 'Failed to check whether sign-ups are open',
  });
  const signupsClosed = registration?.enabled === false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);
    if (useAuthStore.getState().status === 'authenticated') {
      void navigate('/');
    }
  };

  if (authenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthShell
      subtitle="Welcome back, please sign in to your account."
      footer={
        signupsClosed ? undefined : (
          <>
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="font-bold text-primary hover:text-primary/80 inline-flex items-center gap-1 transition-colors"
            >
              Create an account
              <FaArrowRight className="text-[12px] font-bold" />
            </Link>
          </>
        )
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="p-8 flex flex-col gap-6">
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

        <AuthError message={error} onClear={clearError} />

        <AuthSubmit loading={status === 'loading'} label="Sign In" />
      </form>
    </AuthShell>
  );
}
