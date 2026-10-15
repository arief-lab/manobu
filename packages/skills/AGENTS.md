# @manobu/skills

## Purpose

- Markdown skill loader for the Teacher Agent (TASK-1.16). Each sub-agent (ConversationCoach, GrammarExplainer, KanjiTutor, VocabSRS) gets its system prompt + tool instructions from a skill file.

## Ownership

- Project contributors.

## Local Contracts

- Skills are markdown files with zod-validated frontmatter (`name`, `description`, `agent`).
- Resolution order (first hit wins):
  1. `node_modules/@manobu/agent/skills/*.md` (built-in defaults shipped with the agent package)
  2. `.manobu/skills/*.md` (project-local, repo root)
  3. `~/.manobu/skills/*.md` (user-global)
- Public surface: `loadSkills(cwd?, home?)` returns `readonly Skill[]`; `findSkill(name, cwd?, home?)` returns `Skill | null`; `ensureUserSkillsDir(home?)` creates `~/.manobu/skills/` if missing.

## Work Guidance

- Sub-agent system prompts must cite JLPT source data (`Source: Kanji DB` / `Grammar DB`) per the spec §Sensei Voice rules — the loader doesn't enforce this; the skill author does.

## Verification

- `bun --filter @manobu/skills test` (frontmatter parse + missing/invalid error paths).
- `bun --filter @manobu/skills check-types`.

## Child DOX Index

_None._