// A seat's sign-in address: its username under a domain that never gets
// mail. Shared with the web app, which builds the same address to sign in.
// Kept apart from seats.ts so the web side imports nothing of the worker.

export const SEAT_DOMAIN = "seat.lechuga.ai";

export function seatEmail(username: string): string {
  return `${username.toLowerCase()}@${SEAT_DOMAIN}`;
}

export function isSeatEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${SEAT_DOMAIN}`);
}
