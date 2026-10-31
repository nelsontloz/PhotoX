import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../store/auth-store';

const authApi = vi.hoisted(() => ({ getRegistrationSettings: vi.fn() }));

vi.mock('../../api/auth', () => authApi);

import RegisterPage from '.';

const idleAuth = {
  user: null,
  accessToken: null,
  refreshToken: null,
  status: 'idle',
  error: null,
} as const;

const renderPage = () =>
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  useAuthStore.setState({ ...idleAuth });
  authApi.getRegistrationSettings.mockResolvedValue({ enabled: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('RegisterPage sign-up availability', () => {
  it('replaces the form with a notice and a sign-in link when sign-ups are closed', async () => {
    authApi.getRegistrationSettings.mockResolvedValue({ enabled: false });
    renderPage();

    expect(
      await screen.findByText('Public sign-ups are disabled. Ask an administrator for an account.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
    const signIn = screen.getByRole('link', { name: 'Sign in' });
    expect(signIn.getAttribute('href')).toBe('/login');
  });

  it('shows the form while the check is in flight, then swaps to the closed state', async () => {
    let resolveCheck!: (value: { enabled: boolean }) => void;
    authApi.getRegistrationSettings.mockReturnValue(
      new Promise<{ enabled: boolean }>((resolve) => {
        resolveCheck = resolve;
      }),
    );
    renderPage();

    expect(screen.getByLabelText('Full name')).toBeTruthy();

    resolveCheck({ enabled: false });
    expect(
      await screen.findByText('Public sign-ups are disabled. Ask an administrator for an account.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Full name')).toBeNull();
  });

  it('keeps the form when the setting cannot be read — the server still enforces it', async () => {
    authApi.getRegistrationSettings.mockRejectedValue(new Error('offline'));
    renderPage();

    expect(await screen.findByLabelText('Full name')).toBeTruthy();
  });
});
