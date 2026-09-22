import { avatarUrl, type Person } from "../api";

// Someone's face: their photo, or failing that their initial on a colour
// that's always the same for the same person. owner adds the ring that marks
// whose chat it is.
const COLOURS = ["#6fae3b", "#c9803a", "#4f8fb8", "#b0609a", "#8a7bc8", "#3f9c8c", "#c25e5e", "#9a9a3a"];

function colourFor(id: string): string {
  let sum = 0;
  for (const ch of id) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOURS[sum % COLOURS.length];
}

function initial(name: string): string {
  return (name.replace(/^@/, "").trim()[0] ?? "?").toUpperCase();
}

type Props = { person: Person; size?: number; owner?: boolean };

export function Avatar({ person, size = 20, owner = false }: Props) {
  const url = avatarUrl(person);
  const title = owner ? `${person.name} (started this chat)` : person.name;
  return (
    <span
      className={`avatar ${owner ? "owner" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), background: url ? undefined : colourFor(person.id) }}
      title={title}
    >
      {url ? <img src={url} alt={person.name} /> : initial(person.name)}
    </span>
  );
}

// A few faces overlapping, the owner first, then "+2" for whoever didn't fit.
export function AvatarStack({ people, ownerId, size = 18, max = 4 }: { people: Person[]; ownerId: string; size?: number; max?: number }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} owner={p.id === ownerId} />
      ))}
      {extra > 0 && (
        <span className="avatar more" style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }} title={people.slice(max).map((p) => p.name).join(", ")}>
          +{extra}
        </span>
      )}
    </span>
  );
}
