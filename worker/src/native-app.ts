// The native iOS and Android apps (web/ios, web/android) load their pages
// from the phone and call this API from these two origins: the hostname in
// web/capacitor.config.ts under Capacitor's scheme on iOS and https on
// Android. Nothing answers at that name on the internet; it exists to be
// allowed here, and in the Turnstile widget's hostnames. index.ts gives these
// origins CORS headers and auth.ts trusts them; the apps sign in with a
// bearer token rather than the cookie (see web/src/native.ts).
export const APP_ORIGINS = ["capacitor://app.lechuga.ai", "https://app.lechuga.ai"];
