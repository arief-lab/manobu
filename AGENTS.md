# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`
- **Bun runtime**: use Bun `1.4.2`; the root `packageManager` pin and shared `@types/bun` catalog are aligned to `1.4.2`.

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**

- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**

- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**

- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.


# Fallow: Codebase Intelligence

This project uses **fallow** for project-graph analysis: dead code, duplication, complexity hotspots, and architecture boundaries (`.fallowrc.jsonc`, 19 zones / 18 rules). Biome judges files; fallow judges the graph between them. The pre-commit hook runs ultracite (style fixes) plus a scoped `cargo fmt --check` gate (`crates/jlpt-mcp` and `apps/desktop/src-tauri`, each checked only when a `.rs` file under it is staged — see `crates/AGENTS.md`); the pre-push hook runs `fallow audit` (structure gate) — the graph audit charges the whole branch, so it batches per-push, not per-commit. Note that `fallow audit --base <ref>` materializes base-commit checkouts of this repo under `/tmp/fallow-audit-base-cache-*` (tmpfs, ~200 MB each because the Japanese corpora and the vaporetto model are committed); when they pile up they exhaust tmpfs and the gate dies with `could not create a temporary worktree for base ref` — verify each is clean (`git -C <path> status --porcelain` → empty), then `git worktree remove <path>` + `git worktree prune`. `--force` is not needed for clean caches, and it does not help the oldest ones whose `.git` is a directory rather than a file (git refuses them; those need `rm -rf` followed by `prune`).

## When the agent is about to...

| Run | Command |
|---|---|
| delete an "unused" export or file | `fallow dead-code --trace <file>:<export>` — verify zero references first |
| delete an "unused" dependency | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `fallow audit --base main` (runs automatically in pre-push) |
| check architecture boundaries | `fallow dead-code --boundary-violations` — **`fallow audit` does not analyse boundaries** (it runs dead-code + health + dupes only), so this is the only gate on the zone rules |
| refactor a hotspot | `fallow health --hotspots --targets` |
| change a file | `fallow list --boundaries` — shows the boundary zones, their rules, and per-zone file globs (find which zone your file falls in). Read the per-zone **file count** too: a zone at 0 files is a silently dead rule, not a clean one |
| consolidate duplication | `fallow dupes --trace dup:<fingerprint>` |
| debug a finding | `fallow explain <issue-type>` or `fallow dead-code --trace-file <file>` |

## Mutation gate (`bun run gate:mutation`)

fallow judges the graph between files; it cannot tell you whether a test would
notice a break. `scripts/mutation-gate.ts` answers that for a curated list of
high-value seams: it rewrites one exact string per seam, runs that seam's
declared tests, and **fails when the tests still pass** — a surviving mutation
is a coverage hole. It also fails loudly when an anchor goes missing (a moved
seam means the gate is stale, not that the seam is fine). A mutating run
refuses to start when one of its seam files is already dirty, because the seam
would be scored against code its anchor does not describe; `--allow-dirty` says
the edit is yours. Recovery from a killed run is a journal, not a signal
handler: the pre-mutation content goes to `.cache/mutation-gate-journal.json`
before the write and the next run (including `--check`) applies it and exits,
because `runTests` blocks in `spawnSync` for the whole window where a file is
mutated and a JS signal handler cannot fire there (measured 2026-10-14: SIGTERM
at t=1s of a 4s `spawnSync` never ran, and the process exited 0). Before that
was fixed, a `SIGKILL` mid-seam left `chat-persistence.ts` holding the
`host-tool-claim-not-carried` mutation in the tree for days, undiscovered until
a pre-commit anchor check tripped on its missing anchor.

Why it exists: the 2026-09-26 test audit found an inert `Dispute` button that
passed all 452 desktop tests, and the only way to prove it was to break the code
on purpose. `bun run gate:mutation` makes that check repeatable instead of a
one-off. Rules:

- A new seam is added by declaring a mutation in `MUTATIONS` with an exact,
  unique anchor and the test command that must catch it.
- A survivor is **ambiguous on purpose**: either the mutation is too weak to
  change anything (a seam that mixes-but-still-works proves nothing, which is
  how the first avalanche seam passed), or the behavior is genuinely unpinned.
  The two fixes differ, so decide which it is: strengthen the mutation, or
  delete the seam. **Never** loosen the test — the mutation is the specification.
  When you strengthen one, the anchor has to break the *property*, not one of
  the ways it is defended: `exam-sense-group-distractors-dropped` mutated only
  the `seen` dedupe set while `ownConfirmed`'s group filter withheld the same
  thing, so the mutation was a no-op and survived. Its anchor now spans both
  guards.
- A seam's verdict is only worth reading if the same command is GREEN on an
  UNMUTATED tree, and the gate proves that itself: it runs each seam's command
  once before mutating and reports `UNTRUSTWORTHY` when that baseline exits
  non-zero. This matters because bun loads `.env` from the process `cwd`, so
  every `apps/server` suite run with `cwd: ROOT` died in env validation, exited
  non-zero, and was scored as "the mutation was caught" without executing one
  assertion — until 2026-09-28, when every server seam was reporting false
  pasts. `resolveTestPlan` therefore groups a command's path arguments by their
  owning package and runs one `bun test` per package from that package's
  directory, keeping non-path flags in each group; a command whose paths span
  two packages is two exit codes, and every group must be clean for the seam to
  be trusted.
- `bun scripts/mutation-gate.ts --check` resolves every seam anchor without
  writing anything, in milliseconds, and names all stale seams at once. Run it
  after any refactor that moves seeded ordering, folds or validators: a moved
  anchor is a stale gate, not a passing one. **`.husky/pre-commit` runs it on
  every commit that stages TypeScript**, after the `ultracite fix` block and not
  before it, because ultracite reformats in place and a reformatted seam target
  can be the very line an anchor names. A docs-only commit pays nothing, since
  the check is gated on staged `.ts`/`.tsx`. The full mutation run stays manual.
- Source-text assertions (`readFileSync` of a source file + `toContain`) are not
  coverage and cannot be gated this way. Convert or delete them (`TASK-134`).

## Rules

- Always `--format json --quiet` when parsing fallow output programmatically.
- Exit codes: 0 clean, 1 findings, 2 config/runtime error. Don't force success.
- Auto-fix: `fallow fix --dry-run` first, review, then `fallow fix --yes`. Never blind `--yes`.
- Gate model: the pre-push hook runs `fallow audit --base <upstream|main>` — git-diff attribution, so only findings *introduced by the changeset* fail the gate; pre-existing ones are reported as inherited. No static baseline files (the old `.fallow-baseline.json` / `.fallow-health-baseline.json` were dropped 2026-09-15 when the repo reached 0 findings; the hook no longer passes `--*-baseline`).
- Boundaries are clean (0 violations) and enforced: `boundary-violation` is at **`error`** (TASK-71 AC#4, promoted 2026-09-27). Check them with `fallow dead-code --boundary-violations` — note `fallow audit` does NOT include boundaries. Fix violations by moving code or updating the zone `allow` lists in `.fallowrc.jsonc` — never by inline `fallow-ignore` without a one-sentence reason.
- Zone `patterns` are **root-relative**: `test/**` under `"root": "packages/"` means `packages/test/**` and classifies nothing. A zone silently matching 0 files is a dead rule, not a clean one — `fallow list --boundaries` prints the per-zone file count; check it after touching any zone (`coverage.requireAllFiles=true` does not catch it).
- Suppression tokens: `boundary-violation` (import direction + coverage + forbidden calls), `code-duplication` (clones), per-issue-type for dead code. Bare `fallow-ignore` suppresses everything — too broad.

# UI copy voice (antislop audit-001, R-02)

- No em dash (`—`) in user-visible strings. Use `:`, `.`, `·`, or
  parentheses. Fixed across the surfaces shipped by TASK-72/73 (reader,
  roleplay, token popover); older strings elsewhere are grandfathered
  and get fixed when touched.
- R-02 is **guarded**: `packages/ui/test/copy-snapshot.test.ts` walks every
  key's `primary`, `edge` and `error` and fails on an em dash, so a new string
  cannot ship one. The deck (`packages/ui/src/lib/copy.ts:95`) is clean; the
  em dashes left in that file are in its own comments, which the guard does
  not read.
- **Outside the deck the rule is still unguarded**: 119 rendered em dashes
  remain in feature code, 11 more as missing-value placeholder glyphs. The
  work order is `doc-20`; the scanner is committed, so the list regenerates:
  `bun scripts/voice-sweep.ts apps packages crates --categories`. Do not add
  a new one, and fix the strings you touch.
- Contrast contract: text on a solid token fill must clear WCAG AA
  4.5:1. The app ships ONE theme (sumi/kibari/ai/shu, DESIGN.md): no
  theme toggle, no `dark:` variants, no next-themes. Do not reintroduce
  them.

# DOX framework

- DOX is highly performant AGENTS.md hierarchy installed here
- Agent must follow DOX instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Canonical-per-subtree rule

- For each subtree there is exactly **one canonical AGENTS.md**: the file at the subtree root (`apps/desktop/AGENTS.md`, `apps/server/AGENTS.md`, `crates/jlpt-mcp/AGENTS.md`, `packages/<name>/AGENTS.md`, etc.). The canonical doc owns: purpose, ownership, local contracts, verification, and the Child DOX Index of its subtree.
- A **sub-canonical** AGENTS.md may exist one level deeper when a sub-subtree has its own scope that does not fit cleanly in the parent (example: `apps/desktop/src/features/AGENTS.md` — the feature-tier data-fetching split is its own concern, not duplicated in `apps/desktop/AGENTS.md`).
- Every other AGENTS.md file in the subtree is a **thin pointer**: it carries only what is local to that directory (entry points, generated-file notes, skills/work guidance specific to the file types there) and points to the canonical doc for the canonical contracts.
- Anti-pattern: the same `lib/` / `routes/` / `components/` index duplicated verbatim across multiple AGENTS.md files in the same subtree. If a sub-doc needs the same index, link to the canonical doc instead. Duplication is the failure mode this rule prevents.
- Rationale: the recent AI-agent DOX-staleness audit (TASK-25.x) showed that **2 of the 3 commits that touched `apps/desktop/src/lib/` left the matching audit table rows stale**. The root cause was that the same lib list existed in two places (line 23 layout, line 49 child index) and only one was updated. Reducing to one canonical place eliminates the divergence.

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the DOX chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child DOX Index, then prove it: `bun run check:dox` fails when a child `AGENTS.md` exists that no parent names. An unindexed child is invisible to a top-down read, which is how `api-contract` sat undocumented-from-the-root while its own doc answered the question.
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

- 読解 must be finished at EVERY level N5–N1, and "finished" means the 大問 trains its real ねらい and has depth, not merely that a store exists. Do not recommend moving on to 聴解 or any other section while a 読解 gap remains at any level (owner's instruction, 2026-10-09, while closing TASK-173.9.16).

## Child DOX Index

- `apps/AGENTS.md` — deployable apps (`server`, `desktop`).
- `packages/AGENTS.md` — shared workspaces. Its own Child DOX Index is canonical for the `packages/*` docs; do not re-list them here. A partial copy reads as a complete one: this line named 5 of 13 for a long stretch and the omissions included `api-contract`. Guard: `bun run check:dox`.
- `crates/AGENTS.md` — Rust crates (`jlpt-mcp`, the JLPT stdio MCP sidecar).

Root-owned files: `README.md`, `LICENSE`, root manifests (`package.json`, `turbo.json`, `bun.lock`, `tsconfig.json`), tooling config (`biome.jsonc`, `bts.jsonc`, `.husky/`), repo-wide helper scripts (`scripts/`, e.g. `voice-sweep.ts`, `dox-index-check.ts`, `mutation-gate.ts`, `parity-golden.ts`), editor config (`.vscode/`, `.zed/`), shared instructions (`AGENTS.md`), and root-level VCS rules (`.gitignore`). `.claude/` and `.agents/` are local-only agent-tooling directories (gitignored, untracked 2026-10-15), not root-owned repo files.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.51.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

## Backlog.md house rules (project-owned, outside the generated block)

- When a task title, acceptance criterion, or description names a code symbol (tool name, function, file, flag), quote it from the source with a `file:line` reference. Never write it from recall: TASK-93 shipped titled against a `tokenize_debug` tool that does not exist (the real name is `vaporetto_split`), and the mismatch had to be corrected during execution.
- `backlog task edit --acceptance-criteria` and `--dod` REPLACE THE WHOLE LIST, despite reading like an append: passing one criterion to a task with eight criteria deletes seven. This project lost TASK-173.9.16's AC#1-#7 that way on 2026-10-09 and rebuilt them from `backlog task view`. So: view first, then pass every criterion you want kept (repeat the flag once per item), then view again and count the result. For a single-item change use the incremental flags instead (`--remove-ac <index>`, `--ac <text>` appends; the two families cannot be combined in one command). There is no `backlog task comment` subcommand — append a comment with `backlog task edit <id> --comment "<text>"`.
