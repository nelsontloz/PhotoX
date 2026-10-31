// hard absolute session cap, independent of sliding renewals — an active session must still
// die after a week (refresh rows carry it, access tokens' `sst` claim is checked against it)
export const ABSOLUTE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
