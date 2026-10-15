/**
 * Golden coverage for the remaining cluster-A folds (TASK-81 AC#2):
 * `foldLegacyModelMode` (aioncore dual-shape legacy config fold) and the
 * TerminalRegistry `create`/output-contract surface. Output-shaped
 * assertions (JSON goldens for the fold; state assertions for the
 * registry) so the TASK-81.1 refactor cannot change behavior.
 */

import { describe, expect, test } from "bun:test";

import {
  type AcpConfigOption,
  foldLegacyModelMode,
} from "../src/session-normalize";
import { TerminalRegistry } from "../src/session-terminals";
import { AcpSessionHandle } from "../src/session-types";

// ── foldLegacyModelMode ───────────────────────────────────────────────

describe("foldLegacyModelMode (golden)", () => {
  const MODEL_SHAPE = {
    availableModels: [
      { modelId: "opus", name: "Opus" },
      { modelId: "sonnet", name: null },
    ],
    currentModelId: "opus",
  };
  const MODE_SHAPE = {
    availableModes: [
      { description: "write code", id: "code", name: "Code" },
      { description: null, id: "ask", name: null },
    ],
    currentModeId: "code",
  };

  test("legacy models only: model option synthesized", () => {
    const out = foldLegacyModelMode([], MODEL_SHAPE, null);
    expect(out).toEqual({
      currentModeId: null,
      options: [
        {
          category: "model",
          currentValue: "opus",
          description: null,
          id: "model",
          name: "Model",
          options: [
            { description: null, name: "Opus", value: "opus" },
            { description: null, name: "sonnet", value: "sonnet" },
          ],
          type: "select",
        },
      ],
    });
  });

  test("legacy modes only: mode option + currentModeId", () => {
    const out = foldLegacyModelMode([], null, MODE_SHAPE);
    expect(out).toEqual({
      currentModeId: "code",
      options: [
        {
          category: "mode",
          currentValue: "code",
          description: null,
          id: "mode",
          name: "Mode",
          options: [
            { description: "write code", name: "Code", value: "code" },
            { description: null, name: "ask", value: "ask" },
          ],
          type: "select",
        },
      ],
    });
  });

  test("both legacy shapes present: both options appended, mode id wins", () => {
    const out = foldLegacyModelMode([], MODEL_SHAPE, MODE_SHAPE);
    expect(out.currentModeId).toBe("code");
    expect(out.options.map((o) => o.id)).toEqual(["model", "mode"]);
  });

  test("existing modern options win: legacy shape skipped", () => {
    const modern: AcpConfigOption[] = [
      {
        category: "model",
        currentValue: "modern",
        description: null,
        id: "model",
        name: "Model",
        options: [{ description: null, name: "Modern", value: "modern" }],
        type: "select",
      },
    ];
    const out = foldLegacyModelMode(modern, MODEL_SHAPE, MODE_SHAPE);
    expect(out.options.find((o) => o.id === "model")?.currentValue).toBe(
      "modern"
    );
    expect(out.options.filter((o) => o.id === "model")).toHaveLength(1);
  });

  test("neither shape: passthrough", () => {
    expect(foldLegacyModelMode([], null, null)).toEqual({
      currentModeId: null,
      options: [],
    });
  });

  test("null current ids degrade to empty strings, not crashes", () => {
    const out = foldLegacyModelMode(
      [],
      { availableModels: null, currentModelId: null },
      { availableModes: null, currentModeId: null }
    );
    expect(out.currentModeId).toBe(null);
    expect(out.options.find((o) => o.id === "model")?.currentValue).toBe("");
  });
});

// ── TerminalRegistry.create / output contract ─────────────────────────

describe("TerminalRegistry (golden behavior pin)", () => {
  const REGISTRY = new TerminalRegistry();
  // Real handle: the registry emits cumulative snapshot frames through it.
  const HANDLE = new AcpSessionHandle("golden");
  HANDLE.sessionId = "ses-golden";
  HANDLE.lastSink = () => undefined;

  test("create spawns, streams output, and exits with a code", async () => {
    const id = REGISTRY.create(HANDLE, {
      args: ["golden-terminal-output"],
      command: "echo",
    });
    expect(typeof id).toBe("string");
    // Wait for exit then read the buffered output.
    await Bun.sleep(150);
    const view = REGISTRY.output(id);
    expect(view.output).toContain("golden-terminal-output");
    expect(view.exitStatus?.exitCode).toBe(0);
  });

  test("env vars are forwarded to the child", async () => {
    const id = REGISTRY.create(HANDLE, {
      args: ["-c", "echo $GOLDEN_PROBE"],
      command: "sh",
      env: [{ name: "GOLDEN_PROBE", value: "env-forwarded" }],
    });
    await Bun.sleep(200);
    expect(REGISTRY.output(id).output).toContain("env-forwarded");
  });

  test("cwd is honored", async () => {
    const id = REGISTRY.create(HANDLE, {
      command: "pwd",
      cwd: "/tmp",
    });
    await Bun.sleep(200);
    expect(REGISTRY.output(id).output).toContain("/tmp");
  });
});
