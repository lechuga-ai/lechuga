import { useEffect, useState } from "react";
import { Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { SignInCard, SignInScreen } from "./components/SignIn";
import { Legal } from "./components/Legal";
import { HomePage } from "./routes/HomePage";
import { AboutPage, PricingPage, WhatsNewPage } from "./routes/StaticPages";
import { HelpPage } from "./routes/HelpPage";
import { TipsPage } from "./routes/TipsPage";
import { TrialPage } from "./routes/TrialPage";
import { readTrial, saveDraft, setTrialMessage } from "./startMessage";
import { listModels, type Model } from "./api";

// Everything a signed-out visitor can see: the home page, its one free chat
// at /try, the sign-in card as an overlay on both, full-page sign-in for
// links that need a session, and the public pages.
export function Visitor() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  // Which view the overlay opens on, or null when it's closed. A refused
  // sign-in comes back as "/?error=..."; the card reads that itself and shows
  // the invite-only view, so it only needs to be open.
  const [overlay, setOverlay] = useState<"signin" | "request" | null>(() =>
    new URLSearchParams(window.location.search).get("error") ? "signin" : null
  );

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m);
        if (m.length > 0) setSelectedModel(m[0].id);
      })
      .catch(() => setModels([]));
  }, []);

  // Typing on the home page slides into the app at /try, where the first
  // message of the day is answered without an account. A visitor who has had
  // today's free chat sees it again with the invitation under it, and the new
  // message is kept for this tab: it starts once they're back with a session
  // (routes/StartPage.tsx). The worker enforces the limit either way.
  async function handleSend(content: string, model?: string) {
    const today = new Date().toISOString().slice(0, 10);
    if (readTrial()?.day === today) saveDraft(content, model ?? selectedModel);
    else setTrialMessage(content);
    navigate("/try");
  }

  return (
    <div className={`app ${pathname === "/try" ? "chat-mode" : "landing"}`}>
      <Routes>
        <Route
          path="/"
          element={
            <HomePage
              models={models}
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              onSend={handleSend}
              onSignIn={() => setOverlay("signin")}
              onRequestInvite={() => setOverlay("request")}
            />
          }
        />
        <Route
          path="/try"
          element={<TrialPage models={models} onSignIn={() => setOverlay("signin")} onRequestInvite={() => setOverlay("request")} />}
        />
        <Route path="/invite/:token" element={<InviteRoute />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/whats-new" element={<WhatsNewPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="/tips" element={<TipsPage />} />
        <Route path="/terms" element={<Legal page="terms" />} />
        <Route path="/privacy" element={<Legal page="privacy" />} />
        {/* A chat, /billing, /admin...: sign in, then land where you were going. */}
        <Route path="*" element={<ReturnRoute />} />
      </Routes>
      {overlay && (
        <div className="signin-overlay">
          <div className="signin-backdrop" onClick={() => setOverlay(null)} />
          <SignInCard key={overlay} callbackURL="/" startOnRequest={overlay === "request"} onClose={() => setOverlay(null)} />
        </div>
      )}
    </div>
  );
}

function InviteRoute() {
  const { token = "" } = useParams();
  return <SignInScreen callbackURL="/" inviteToken={token} />;
}

function ReturnRoute() {
  const { pathname } = useLocation();
  return <SignInScreen callbackURL={pathname} />;
}
