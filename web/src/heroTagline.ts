import facts from "./lechuga-facts.txt?raw";

const CLASSIC = "Lechuga is lettuce in Spanish.";
const CLASSIC_VIEWS = 3;
const KEY = "lechuga:startViews";

const FACTS = facts
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

// The line under the wordmark on the signed-in start page. The first few
// visits get the classic; after that, a random line from lechuga-facts.txt.
// Counted per browser (localStorage), which is close enough to "per account"
// for a joke. Call once per mount. React's StrictMode mounts twice in
// development, so two calls within a second count as one view.
let lastCounted = 0;

export function heroTagline(): string {
  let views = 0;
  try {
    views = Number(localStorage.getItem(KEY)) || 0;
    if (Date.now() - lastCounted > 1000) {
      localStorage.setItem(KEY, String(views + 1));
      lastCounted = Date.now();
    } else {
      views -= 1;
    }
  } catch {
    // no storage (private window): the classic, every time
  }
  if (views < CLASSIC_VIEWS || FACTS.length === 0) return CLASSIC;
  return FACTS[Math.floor(Math.random() * FACTS.length)];
}
