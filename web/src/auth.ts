import { createAuthClient } from "better-auth/react";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { API_BASE, NATIVE, getToken, setToken } from "./native";

// Same origin, default path (/api/auth), which is where the worker mounts
// Better Auth. The session cookie is HttpOnly, so the client never sees it;
// it just rides along on every fetch.
// The code plugin is the installed-app sign-in (see installed.ts).
//
// Inside the native app the API is on another domain and the cookie can't be
// relied on, so the worker's bearer plugin returns the session token in a
// set-auth-token header when a sign-in completes; it's kept (native.ts) and
// sent as Authorization: Bearer on every call from then on.
export const authClient = createAuthClient({
  baseURL: API_BASE || undefined,
  plugins: [magicLinkClient(), emailOTPClient()],
  fetchOptions: NATIVE
    ? {
        // No cookies across origins (the worker's CORS answer doesn't allow
        // them, and the app doesn't use them): the token is the session.
        credentials: "omit",
        auth: { type: "Bearer", token: () => getToken() ?? "" },
        onSuccess: (ctx) => {
          const token = ctx.response.headers.get("set-auth-token");
          if (token) setToken(token);
        },
      }
    : {},
});

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};
