import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import App from "./App";
import { Visitor } from "./Visitor";
import { Username } from "./components/Username";
import { Admin } from "./components/Admin";
import { Legal } from "./components/Legal";
import { WhatsNewPage } from "./routes/StaticPages";
import { HelpPage } from "./routes/HelpPage";
import { GettingStartedPage } from "./routes/GettingStartedPage";
import { SettingsPage } from "./routes/SettingsPage";
import { BotPage } from "./routes/BotPage";
import { WelcomePage } from "./routes/WelcomePage";
import { authClient } from "./auth";
import { getMe, type Me } from "./api";
import { clearToken } from "./native";

// Session gate and the top of the routing. It only decides what to show: the
// worker enforces sign-in with a 401 on every private /api route.
//
//   no session        Visitor: the home page, sign-in screens, public pages
//   no username yet   the username step (and the legal pages it links to)
//   signed in         /admin, /settings, /welcome, public pages; everything
//                     else is App, which routes / and /c/<id> itself
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
      <Route path="/about" element={<Navigate to="/welcome#who-we-are" replace />} />
      <Route path="/whats-new" element={<WhatsNewPage />} />
      <Route path="/pricing" element={<Navigate to="/welcome#what-it-costs" replace />} />
      <Route path="/help" element={<HelpPage me={me} />} />
      <Route path="/help/getting-started" element={<GettingStartedPage />} />
      <Route path="/tips" element={<Navigate to="/help/getting-started" replace />} />
      <Route path="/welcome" element={<WelcomePage />} />
      <Route path="/settings" element={<SettingsPage me={me} onMeChange={setMe} />} />
      <Route path="/settings/credits" element={<SettingsPage me={me} onMeChange={setMe} />} />
      <Route path="/settings/memory" element={<SettingsPage me={me} onMeChange={setMe} />} />
      <Route path="/bots/:id" element={<BotPage />} />
      <Route path="/admin" element={me.isAdmin ? <Admin me={me} /> : <Navigate to="/" replace />} />
      {/* Where credits lived before Settings, and where older Stripe sessions
          send people back to. The query string (?checkout=success) rides
          along so the thank-you still shows. */}
      <Route path="/billing" element={<ToCredits />} />
      <Route path="/usage" element={<ToCredits />} />
      <Route
        path="*"
        element={
          <App
            me={me}
            onSignOut={async () => {
              await authClient.signOut();
              // The native app's copy of the session token (a no-op on the web).
              clearToken();
            }}
          />
        }
      />
    </Routes>
  );
}

function ToCredits() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/settings/credits", search }} replace />;
}
