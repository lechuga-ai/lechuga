// Cloudflare Turnstile, loaded from its script tag in index.html.
// Only the parts the sign-in page uses.
interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  // Called with Turnstile's error code, e.g. "110200" (hostname not allowed).
  "error-callback"?: (code?: string) => void;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "compact" | "flexible";
}

interface Window {
  turnstile?: {
    render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
    reset: (widgetId?: string) => void;
    remove: (widgetId: string) => void;
  };
}
