import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { SideNavPage, type NavGroup } from "../components/SideNavPage";
import { ProfileForm } from "../components/ProfileForm";
import { BillingPanel } from "../components/Billing";
import { MemoryForm } from "../components/MemoryForm";
import { BotManager } from "../components/BotManager";
import { listBots, type Bot, type Me } from "../api";
import { NATIVE } from "../native";

type Props = {
  me: Me;
  // After a profile change, so the new name and face show everywhere.
  onMeChange: (me: Me) => void;
};

const NAV: NavGroup[] = [
  { to: "/settings", label: "Profile" },
  { to: "/settings/memory", label: "Memory" },
  // Its sections are the bots themselves, filled in below once they load.
  { to: "/settings/bots", label: "Bot Manager" },
  {
    to: "/settings/credits",
    label: "Credits",
    sections: [
      { id: "balance", label: "Your balance" },
      { id: "buy", label: "Buy credits" },
      { id: "purchases", label: "Your purchases" },
      { id: "account", label: "Your account" },
      // The native app doesn't sell credits (Billing.tsx), so no entry for it.
    ].filter((s) => !(NATIVE && s.id === "buy")),
  },
];

// /settings, "Account" in the menu behind your name: everything about the
// account that isn't a chat, one page per entry in the nav. Profile is your
// name and photo; Memory is what Lechuga carries between your chats; Bot
// Manager is each bot's name, model and behaviour; Credits is the balance,
// buying, the subscription, and (at the foot) deleting the account.
export function SettingsPage({ me, onMeChange }: Props) {
  const { pathname } = useLocation();
  const [bots, setBots] = useState<Bot[]>([]);
  useEffect(() => {
    listBots().then(setBots).catch(() => setBots([]));
  }, []);
  const page =
    pathname === "/settings/credits" ? "Credits" : pathname === "/settings/memory" ? "Memory" : pathname === "/settings/bots" ? "Bot Manager" : "Profile";
  const nav = NAV.map((g) => (g.to === "/settings/bots" ? { ...g, sections: bots.map((b) => ({ id: b.id, label: b.name })) } : g));
  return (
    <SideNavPage title={page} nav={nav} navLabel="Account">
      {page === "Credits" ? (
        <BillingPanel me={me} />
      ) : page === "Memory" ? (
        <MemoryForm />
      ) : page === "Bot Manager" ? (
        <BotManager me={me} bots={bots} onBotsChange={setBots} />
      ) : (
        <ProfileForm me={me} onSaved={(profile) => onMeChange({ ...me, ...profile })} />
      )}
    </SideNavPage>
  );
}
