# manobu

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-F9F1F1?logo=bun&logoColor=black)
![SQLite](https://img.shields.io/badge/SQLite-0F80CC?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-AGPL--3.0-blue)
![Release](https://img.shields.io/github/v/release/arief-lab/manobu?include_prereleases&color=7C3AED)

> **⚠️ Alpha** — manobu is under active development. The study surfaces are in daily use, but things break, there are no auto-updates yet, installers are not code-signed, and saved data may change format between versions.

A local-first JLPT study app for the desktop. manobu covers the full N5 to N1 range in one window: vocabulary and grammar decks, spaced-repetition review, a Japanese reader with native tokenization, listening practice, kanji study with stroke order, verb conjugation drills, roleplay, an AI tutor, and full mock exams generated to the real JLPT blueprint, with official section timers and band scoring.

Everything runs on your machine. The app ships its dictionaries, corpora and tokenizer inside the bundle, so study sessions need no internet and your progress data never leaves the device. The one exception is first run: the speech model for listening practice is downloaded once, and the AI tutor talks to a local agent CLI you point at any model provider you like.

![manobu first-run setup](assets/screenshots/00-setup.png)

## Download

Grab the latest pre-release from the [releases page](https://github.com/arief-lab/manobu/releases/latest):

| Platform | File | Notes |
|---|---|---|
| Windows x64 | `manobu_x_x64-setup.exe` | Not code-signed: SmartScreen will warn once, click "More info" then "Run anyway". |
| Linux x64 | `manobu_x_x64.deb` | Debian/Ubuntu, `sudo apt install ./manobu_*.deb`. |
| Linux (any) | `manobu_x_amd64.AppImage` | `chmod +x` and run; no install needed. |

macOS builds are not part of the alpha yet.

## Features

- **Dashboard** · today's review queue, practice streak, and quick access to every surface.
- **Drill & review** · SRS-backed vocabulary and grammar decks with four-option items validated against the shipped corpora.
- **Reader** · paste or pick Japanese text, get native vaporetto tokenization, tap any word for a dictionary lookup, and save the unknown ones to your decks.
- **Kanji** · stroke-order animations, readings and word lists per level.
- **Conjugate lab** · one card per verb and form (te, ta, negative, tai, potential, polite), covering godan, ichidan and irregular verbs with onbin.
- **Listen** · listening comprehension at your level, with the speech model downloaded and run locally.
- **Roleplay** · conversation scenes you work through one spoken line at a time; every line you save feeds the same SRS queue, and the transcript is the reward.
- **Ask Sensei** · AI chat tutor with conversation history. It drives a local agent CLI over ACP, and that agent reaches the same dictionaries and tokenizer through the bundled MCP server.
- **Mock exams** · generated papers at shortened, exam-conditions and full real-paper modes, following the official 大問 structure, section timers, and scoring bands.

## Architecture

A Bun + Turborepo monorepo: three runtime pieces over a shared package layer.

| Path | What it is |
|---|---|
| `apps/desktop` | Tauri 2 desktop shell. React UI with TanStack Router and Query. |
| `apps/server` | Bun sidecar: the study API, exam generator, and SRS engine, exposed over oRPC and served by Hono. |
| `crates/jlpt-mcp` | Rust stdio MCP server. Embeds the Japanese corpora and the vaporetto tokenizer (sqlite-vaporetto). |
| `packages/*` | Shared workspaces: `db` (libsql/SQLite), `japanese` (licensed corpora and checks), `item-engine` (paper blueprints), `ui`, `api-contract`, `agent`, `acp`, `chat-session`, `srs`, `speech`, `skills`, `jlpt-mcp`, `env`, `config`. |

The desktop app spawns the Bun sidecar locally and talks to the Rust MCP sidecar for tokenization and dictionary queries. All data lives in a local SQLite database.

## Getting started

Prerequisites: [Bun](https://bun.sh) 1.4.2 (pinned via `packageManager`), a stable Rust toolchain, and the Tauri system dependencies for your platform.

```sh
bun install

# UI with hot reload in the browser (run `bun run dev:server` alongside
# it for the API sidecar)
bun run dev:desktop

# Full Tauri window (compiles the Rust side the first time)
cd apps/desktop && bun run desktop:dev

# Production bundle
cd apps/desktop && bun run desktop:build
```

On first launch the app opens the setup screen above: pick what brought you
here (travel, the JLPT, anime, work, or fun) and the decks, reader and exams
all target that level.

## Development

```sh
bun run build            # turbo build across all workspaces
bun test                 # JS/TS tests per package (turbo run test)
bun run test:rust        # cargo tests for crates/jlpt-mcp
bun run check-types      # typecheck all workspaces
bun x ultracite fix      # lint + format (Biome preset)
bun run check:dox        # AGENTS.md hierarchy index check
bun run gate:mutation    # mutation gate on the curated high-value seams
bun run db:local         # local SQLite database helpers (see db:push, db:migrate, db:studio)
```

Repo conventions live in the `AGENTS.md` hierarchy, rooted at [`AGENTS.md`](AGENTS.md).

## License

Copyright (C) 2026 manobu contributors

The source code is licensed under **AGPL-3.0** ([`LICENSE`](LICENSE)). The bundled Japanese language data keeps its own licenses (CC BY / CC BY-SA / public domain, per dataset); the full attribution ledger is in [`packages/japanese/data/LICENSE.md`](packages/japanese/data/LICENSE.md), and `crates/jlpt-mcp` embeds that data under CC BY-SA 4.0.
