import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { Visitor } from "./Visitor";
import { Username } from "./components/Username";
import { Admin } from "./components/Admin";
import { Legal } from "./components/Legal";
import { Billing } from "./components/Billing";
import { AboutPage, PricingPage, WhatsNewPage } from "./routes/StaticPages";
import { HelpPage } from "./routes/HelpPage";
import { TipsPage } from "./routes/TipsPage";
import { authClient } from "./auth";
import { getMe, type Me } from "./api";

// Session gate and the top of the routing. It only decides what to show: the
// worker enforces sign-in with a 401 on every private /api route.
//
//   no session        Visitor: the home page, sign-in screens, public pages
//   no username yet   the username step (and the legal pages it links to)
//   signed in         /admin, /billing, public pages; everything else is App,
//                     which routes / and /c/<id> itself
export default function Root() {
  const { data: session, isPending } = authClient.useSession();
  const [me, setMe] = useState<Me | null>(null);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) {
      setMe(null);
      return;
    }
    let cancelled = false;
    getMe()
      .then((m) => !cancelled && setMe(m))
      .catch(() => !cancelled && setMe(null));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (isPending) return null;
  if (!session) return <Visitor />;
  if (!me) return null;

  // First sign-in: pick a username before anything else (plan v3, step 5).
  // A message typed on the home page before signing in waits in
  // sessionStorage and starts once this step is done.
  if (!me.username) {
    return (
      <Routes>
        <Route path="/terms" element={<Legal page="terms" />} />
        <Route path="/privacy" element={<Legal page="privacy" />} />
        <Route path="*" element={<Username onDone={(username) => setMe({ ...me, username })} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/terms" element={<Legal page="terms" />} />
      <Route path="/privacy" element={<Legal page="privacy" />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/whats-new" element={<WhatsNewPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/help" element={<HelpPage me={me} />} />
      <Route path="/tips" element={<TipsPage />} />
      <Route path="/admin" element={me.isAdmin ? <Admin me={me} /> : <Navigate to="/" replace />} />
      {/* /usage is where Stripe's portal was told to send people back to; it
          gets its own page in Phase 4. */}
      <Route path="/billing" element={<Billing me={me} />} />
      <Route path="/usage" element={<Billing me={me} />} />
      <Route
        path="*"
        element={
          <App
            me={me}
            onMeChange={setMe}
            onSignOut={async () => {
              await authClient.signOut();
            }}
          />
        }
      />
    </Routes>
  );
}
