// True when Lechuga is running as an installed app (Safari's Add to Home
// Screen or Add to Dock, Chrome's Install) rather than in a browser tab.
// Installed copies on iOS and macOS have their own cookies, separate from
// the browser's, which is why sign-in works differently there (SignIn.tsx).
import { NATIVE } from "./native";

export function isInstalledApp(): boolean {
  if (NATIVE) return true;
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // Older iOS Safari sets its own flag instead of answering the media query.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
