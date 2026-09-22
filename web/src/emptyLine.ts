import config from "../../worker/config.json";

export function randomEmptyLine(): string {
  return config.empty_lines[Math.floor(Math.random() * config.empty_lines.length)];
}
