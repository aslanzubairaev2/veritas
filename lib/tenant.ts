import fs from "node:fs";
import path from "node:path";

export type Lang = "de" | "ru";

export type Company = {
  id: string;
  name: string;
  shortName: string;
  tagline: Record<Lang, string>;
  phone: string;
  phoneHref: string;
  email: string;
  website: string;
  hours: Record<Lang, string>;
  locations: { label: string; address: string; phone: string }[];
  quickQuestions: Record<Lang, string[]>;
};

const dir = path.join(process.cwd(), "tenant");
let cache: { company: Company; knowledge: string } | null = null;

export function getTenant() {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const company = JSON.parse(fs.readFileSync(path.join(dir, "company.json"), "utf8")) as Company;
  const knowledge = fs.readFileSync(path.join(dir, "knowledge.md"), "utf8");
  cache = { company, knowledge };
  return cache;
}
