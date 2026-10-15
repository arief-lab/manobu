/**
 * TASK-102 AC#4/#6: the engine's failure-based auth classification and the
 * two tagged turn errors. These are the seams the server projects onto the
 * terminal frame (`.code`) and the client renders, so the contract under test
 * is the message text plus the code, not a class identity.
 */

import { expect, test } from "bun:test";

import {
  acpAuthRequiredError,
  acpConfigSwitchError,
  isAuthRejection,
} from "../src/session-child";

// ── isAuthRejection: the words, never the advertised methods ─────────

test("isAuthRejection: recognises an agent's auth phrasing", () => {
  for (const message of [
    "Authentication required",
    "auth required to open a session",
    "you are not authenticated",
    "Unauthorized: missing token",
    "please log in first",
    "please sign-in to continue",
    "must sign in before chatting",
    "needs to login",
  ]) {
    expect(isAuthRejection(new Error(message))).toBe(true);
  }
});

test("isAuthRejection: a non-auth rejection is not signed-out (non-regressive)", () => {
  // An opencode-like agent that chats anonymously can still fail a session
  // open for an unrelated reason; misclassifying that as auth would show a
  // sign-in prompt for a learner who is already usable.
  for (const message of [
    "ENOENT: no such file or directory",
    "connection closed",
    "invalid cwd",
    "session capacity exceeded",
    "unknown method session/new",
  ]) {
    expect(isAuthRejection(new Error(message))).toBe(false);
  }
});

test("isAuthRejection: classifies from a non-Error rejection too", () => {
  expect(isAuthRejection("Authentication required")).toBe(true);
  expect(isAuthRejection({ code: -32_000 })).toBe(false);
});

// ── acpAuthRequiredError: sign-in legibility + preserved cause ───────

test("acpAuthRequiredError: names the methods and carries the code and cause", () => {
  const cause = new Error("Authentication required");
  const error = acpAuthRequiredError(
    "claude",
    ["Claude Code OAuth", "Browser"],
    cause
  );
  expect(error.code).toBe("AUTH_REQUIRED");
  expect(error.message).toContain('agent "claude" needs you to sign in');
  expect(error.message).toContain('"Claude Code OAuth" or "Browser"');
  expect(error.cause).toBe(cause);
});

test("acpAuthRequiredError: with no advertised methods still says sign in", () => {
  const error = acpAuthRequiredError("mystery", [], new Error("auth required"));
  expect(error.code).toBe("AUTH_REQUIRED");
  expect(error.message).toContain("Sign in to the agent CLI first.");
});

// ── acpConfigSwitchError: the rejected switch reaches the learner ────

test("acpConfigSwitchError: reports the rejected model and its reason", () => {
  const cause = new Error("model not offered");
  const error = acpConfigSwitchError(
    "model",
    "gpt-9",
    "model not offered",
    cause
  );
  expect(error.code).toBe("CONFIG_SWITCH_FAILED");
  expect(error.message).toBe(
    'model switch to "gpt-9" was rejected by the agent: model not offered'
  );
  expect(error.cause).toBe(cause);
});

test("acpConfigSwitchError: a rejected mode is reported the same way", () => {
  const error = acpConfigSwitchError(
    "mode",
    "plan",
    "unsupported",
    new Error("x")
  );
  expect(error.code).toBe("CONFIG_SWITCH_FAILED");
  expect(error.message).toContain('mode switch to "plan"');
});
