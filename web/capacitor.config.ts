import type { CapacitorConfig } from "@capacitor/cli";

// The native iOS and Android apps: the web app built with `npm run
// build:native` (see .env.native), wrapped by Capacitor. `npx cap sync` copies
// that build into ios/ and android/; Xcode and Android Studio build from there.
const config: CapacitorConfig = {
  appId: "ai.lechuga.app",
  appName: "Lechuga",
  webDir: "dist-native",
  server: {
    // The origin the pages run under inside the app: capacitor://app.lechuga.ai
    // on iOS, https://app.lechuga.ai on Android. Nothing is served from that
    // name on the internet; it exists so the worker's CORS list and the
    // Turnstile widget's hostnames have one fixed name to allow.
    hostname: "app.lechuga.ai",
    androidScheme: "https",
  },
};

export default config;
