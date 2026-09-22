import config from "../../worker/config.json";

// How hard the model thinks before it answers: the composer's second
// dropdown. It's a preference of the person, not of a chat or a model, so it
// lives in this browser and is sent along with every message. Changing the
// model doesn't touch it, and the other way round.
export type Effort = (typeof config.efforts)[number]["id"];

const KEY = "lechuga:effort";
const valid = (v: unknown): v is Effort => config.efforts.some((e) => e.id === v);

export function getEffort(): Effort {
  try {
    const saved = localStorage.getItem(KEY);
    if (valid(saved)) return saved;
  } catch {
    // no storage: the default
  }
  return config.default_effort as Effort;
}

export function saveEffort(effort: Effort): void {
  try {
    localStorage.setItem(KEY, effort);
  } catch {
    // it just won't be remembered
  }
}
