// Copying a link to the clipboard, with the fallback browsers without the
// clipboard API (or without permission) need: a prompt holding the text,
// which can be copied by hand.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this link:", text);
    return false;
  }
}

// A link into the app for a username-and-code account: it opens the sign-in
// with the username filled in and lands here once signed in. For anyone
// else the query string is ignored.
export function seatLink(path: string, username: string): string {
  return `${window.location.origin}${path}?u=${encodeURIComponent(username)}`;
}

export function appLink(path: string): string {
  return `${window.location.origin}${path}`;
}
