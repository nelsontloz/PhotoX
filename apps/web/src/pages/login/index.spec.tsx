import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../store/auth-store';

const authApi = vi.hoisted(() => ({ getRegistrationSettings: vi.fn() }));

vi.mock('../../api/auth', () => authApi);

import LoginPage from '.';

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
      <LoginPage />
    </MemoryRouter>,
  );

const createAccountLink = () => screen.queryByRole('link', { name: 'Create an account' });

beforeEach(() => {
  useAuthStore.setState({ ...idleAuth });
  authApi.getRegistrationSettings.mockResolvedValue({ enabled: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('LoginPage sign-up link', () => {
  it('hides the sign-up footer once sign-ups are confirmed closed', async () => {
    authApi.getRegistrationSettings.mockResolvedValue({ enabled: false });
    renderPage();

    await waitFor(() => expect(createAccountLink()).toBeNull());
    expect(screen.queryByText(/have an account/)).toBeNull();
    expect(screen.getByLabelText('Email address')).toBeTruthy();
  });

  it('keeps the sign-up footer when sign-ups are open', async () => {
    renderPage();

    await waitFor(() => expect(authApi.getRegistrationSettings).toHaveBeenCalled());
    const link = createAccountLink();
    expect(link?.getAttribute('href')).toBe('/register');
  });

  it('keeps the sign-up footer when the check fails', async () => {
    authApi.getRegistrationSettings.mockRejectedValue(new Error('offline'));
    renderPage();

    await waitFor(() => expect(authApi.getRegistrationSettings).toHaveBeenCalled());
    expect(createAccountLink()).toBeTruthy();
  });
});
