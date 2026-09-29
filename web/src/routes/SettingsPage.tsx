import { useLocation } from "react-router-dom";
import { SideNavPage, type NavGroup } from "../components/SideNavPage";
import { ProfileForm } from "../components/ProfileForm";
import { BillingPanel } from "../components/Billing";
import { MemoryForm } from "../components/MemoryForm";
import type { Me } from "../api";
import { NATIVE } from "../native";

type Props = {
  me: Me;
  // After a profile change, so the new name and face show everywhere.
  onMeChange: (me: Me) => void;
};

const NAV: NavGroup[] = [
  { to: "/settings", label: "Profile" },
  { to: "/settings/memory", label: "Memory" },
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
// name and photo; Memory is what Lechuga carries between your chats; Credits
// is the balance, buying, the subscription, and (at the foot) deleting the
// account.
export function SettingsPage({ me, onMeChange }: Props) {
  const { pathname } = useLocation();
  const page = pathname === "/settings/credits" ? "Credits" : pathname === "/settings/memory" ? "Memory" : "Profile";
  return (
    <SideNavPage title={page} nav={NAV} navLabel="Account">
      {page === "Credits" ? (
        <BillingPanel me={me} />
      ) : page === "Memory" ? (
        <MemoryForm />
      ) : (
        <ProfileForm me={me} onSaved={(profile) => onMeChange({ ...me, ...profile })} />
      )}
    </SideNavPage>
  );
}
