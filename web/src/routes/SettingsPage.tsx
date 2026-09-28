import { useLocation } from "react-router-dom";
import { SideNavPage, type NavGroup } from "../components/SideNavPage";
import { ProfileForm } from "../components/ProfileForm";
import { BillingPanel } from "../components/Billing";
import type { Me } from "../api";

type Props = {
  me: Me;
  // After a profile change, so the new name and face show everywhere.
  onMeChange: (me: Me) => void;
};

const NAV: NavGroup[] = [
  { to: "/settings", label: "Profile" },
  {
    to: "/settings/credits",
    label: "Credits",
    sections: [
      { id: "balance", label: "Your balance" },
      { id: "buy", label: "Buy credits" },
      { id: "purchases", label: "Your purchases" },
      { id: "account", label: "Your account" },
    ],
  },
];

// /settings, "Account" in the menu behind your name: everything about the
// account that isn't a chat, one page per entry in the nav. Profile is your name and photo; Credits is the balance,
// buying, the subscription, and (at the foot) deleting the account.
export function SettingsPage({ me, onMeChange }: Props) {
  const { pathname } = useLocation();
  const credits = pathname === "/settings/credits";
  return (
    <SideNavPage title={credits ? "Credits" : "Profile"} nav={NAV} navLabel="Account">
      {credits ? <BillingPanel me={me} /> : <ProfileForm me={me} onSaved={(profile) => onMeChange({ ...me, ...profile })} />}
    </SideNavPage>
  );
}
