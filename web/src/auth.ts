import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Same origin, default path (/api/auth), which is where the worker mounts
// Better Auth. The session cookie is HttpOnly, so the client never sees it;
// it just rides along on every fetch.
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};
