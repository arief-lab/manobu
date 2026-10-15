/*
 * Skills (markdown) loader — spec §TASK-1.16.
 *
 * Skills are markdown files with zod-validated frontmatter. They supply
 * the system prompt + tool instructions for each sub-agent (Sensei
 * orchestrator, ConversationCoach, GrammarExplainer, KanjiTutor, VocabSRS).
 *
 * Resolution order (first hit wins):
 *   1. `node_modules/<package>/skills/*.md`
 *   2. `.manobu/skills/*.md` (project-local, repo root)
 *   3. `~/.manobu/skills/*.md` (user-global)
 *
 * Each file has frontmatter:
 *   ---
 *   name: ConversationCoach
 *   description: ...
 *   agent: conversation
 *   ---
 *
 * The body is the system prompt (markdown).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const SkillFrontmatterSchema = z.object({
  agent: z.string().min(1),
  description: z.string().min(1),
  name: z.string().min(1),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface Skill {
  body: string;
  frontmatter: SkillFrontmatter;
  source: SkillSource;
}

export type SkillSource =
  | { kind: "node_modules"; path: string }
  | { kind: "project"; path: string }
  | { kind: "user"; path: string };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const LINE_SPLIT_RE = /\r?\n/;
const MD_SUFFIX = /\.md/;

const parseSkillFile = (raw: string, source: SkillSource): Skill => {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    throw new Error(`Skill at ${source.path} is missing --- frontmatter ---`);
  }
  const frontmatterRaw = match[1] ?? "";
  const body = match[2] ?? "";
  const fmParsed = SkillFrontmatterSchema.safeParse(
    parseFrontmatter(frontmatterRaw)
  );
  if (!fmParsed.success) {
    throw new Error(
      `Skill at ${source.path} has invalid frontmatter: ${fmParsed.error.message}`
    );
  }
  return { body, frontmatter: fmParsed.data, source };
};

const parseFrontmatter = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of raw.split(LINE_SPLIT_RE)) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
};

const scanDir = (dir: string, kind: SkillSource["kind"]): readonly Skill[] => {
  if (!existsSync(dir)) {
    return [];
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(MD_SUFFIX.source));
  return files.map((f) => {
    const path = join(dir, f);
    return parseSkillFile(readFileSync(path, "utf8"), {
      kind,
      path,
    } as SkillSource);
  });
};

export const loadSkills = (
  cwd: string = process.cwd(),
  home: string = homedir()
): readonly Skill[] => {
  const userDir = join(home, ".manobu", "skills");
  return [
    ...scanDir(
      join(cwd, "node_modules", "@manobu", "agent", "skills"),
      "node_modules"
    ),
    ...scanDir(join(cwd, ".manobu", "skills"), "project"),
    ...scanDir(userDir, "user"),
  ];
};

export const findSkill = (
  name: string,
  cwd?: string,
  home?: string
): Skill | null =>
  loadSkills(cwd, home).find((s) => s.frontmatter.name === name) ?? null;

export const ensureUserSkillsDir = (home: string = homedir()): string => {
  const dir = join(home, ".manobu", "skills");
  mkdirSync(dir, { recursive: true });
  return dir;
};

export const __test__ = {
  parseFrontmatter,
  parseSkillFile,
};
