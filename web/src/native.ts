// The web app inside the native iOS and Android apps (web/ios, web/android,
// wrapped by Capacitor). Built with `npm run build:native`, which reads
// .env.native; on the website both values below are empty and everything
// here is a no-op.

// True inside the native app.
export const NATIVE = import.meta.env.VITE_NATIVE === "1";

// Where /api lives. Inside the app the pages come from the phone, so the API
// needs an absolute address; on the website it's the same origin, so "".
export const API_BASE: string = NATIVE ? (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "") : "";

// The sign-in token, inside the app. The website uses a cookie the browser
// sends by itself; an app calling another domain can't rely on that, so
// Better Auth's bearer plugin hands out the session token in a header on
// sign-in (auth.ts stores it) and every request carries it back (apiFetch).
const TOKEN_KEY = "lechuga.session";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Nothing to do: the next launch will ask to sign in again.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

// fetch for /api paths: the API's address in front, the sign-in token along.
// On the website it's exactly fetch(path).
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = NATIVE ? getToken() : null;
  if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  return fetch(API_BASE + path, { ...init, headers });
}
