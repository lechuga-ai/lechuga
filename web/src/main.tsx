import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import Root from "./Root";
import "./styles.css";
import { NATIVE } from "./native";

// The service worker (public/sw.js) that lets an installed copy open from
// cache. Production only: with Vite's dev server it would cache the wrong
// files and hide your changes. Not in the native app either: its pages are
// already on the phone.
if (import.meta.env.PROD && !NATIVE && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Nothing to do: the site works the same without it.
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>
);
