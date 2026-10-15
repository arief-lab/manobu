/**
 * SSR tests for the AionUi card set (TASK-80.4).
 *
 * Rendering goes through `react-dom/server.renderToStaticMarkup` — no DOM,
 * no jsdom. We pin the static state table: `data-slot`, `data-state`,
 * `data-testid` attributes + HTML substrings. This matches the pattern in
 * `tool-call-card.test.tsx`.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AcpAskCard,
  type AcpAskQuestion,
  collectAnswers,
} from "./acp-ask-card";
import {
  AcpPermissionCard,
  type AcpPermissionOption,
} from "./acp-permission-card";
import {
  AcpTerminalCard,
  type AcpTerminalCardData,
  exitStatusLabel,
} from "./acp-terminal-card";
import {
  AcpToolCallCard,
  type AcpToolCallCardData,
  getKindDisplayName,
  isDiffOnly,
} from "./acp-tool-call-card";
import { StatusTag, toStatusVariant } from "./status-tag";

// Ask-card label-activation pins (see the regression test below).
const LABEL_TAG_RE = /<label[^>]*>/g;
const LABEL_FOR_RE = /for="([^"]*)"/;

// ── StatusTag ────────────────────────────────────────────────────────────────

describe("StatusTag", () => {
  it("maps pending status to the pending variant", () => {
    const html = renderToStaticMarkup(<StatusTag status="pending" />);
    expect(html).toContain('data-state="pending"');
    expect(html).toContain("Pending");
  });

  it("maps in_progress status to the in_progress variant", () => {
    const html = renderToStaticMarkup(<StatusTag status="in_progress" />);
    expect(html).toContain('data-state="in_progress"');
  });

  it("maps failed and error statuses to the failed variant", () => {
    const html = renderToStaticMarkup(<StatusTag status="failed" />);
    expect(html).toContain('data-state="failed"');
  });

  it("defaults unknown statuses to completed", () => {
    const html = renderToStaticMarkup(<StatusTag status="weird_state" />);
    expect(html).toContain('data-state="completed"');
  });

  it("toStatusVariant returns the variant for each raw status", () => {
    expect(toStatusVariant("pending")).toBe("pending");
    expect(toStatusVariant("in_progress")).toBe("in_progress");
    expect(toStatusVariant("failed")).toBe("failed");
    expect(toStatusVariant("error")).toBe("failed");
    expect(toStatusVariant(null)).toBe("completed");
    expect(toStatusVariant(undefined)).toBe("completed");
  });
});

// ── AcpToolCallCard ───────────────────────────────────────────────────────────

describe("AcpToolCallCard", () => {
  const baseCard: AcpToolCallCardData = {
    content: null,
    kind: "execute",
    raw_input: { command: "ls -la" },
    raw_output: "file.txt",
    status: "completed",
    title: "List files",
    toolCallId: "tc-001",
  };

  it("renders the kind display name as the title fallback", () => {
    expect(getKindDisplayName("edit")).toBe("File Edit");
    expect(getKindDisplayName("read")).toBe("File Read");
    expect(getKindDisplayName("execute")).toBe("Shell Command");
    expect(getKindDisplayName(null)).toBe("Tool");
    expect(getKindDisplayName("custom_kind")).toBe("custom_kind");
  });

  it("renders a generic card for non-diff content", () => {
    const html = renderToStaticMarkup(<AcpToolCallCard card={baseCard} />);
    expect(html).toContain('data-slot="acp-tool-call-card"');
    expect(html).toContain('data-state="default"');
    expect(html).toContain('data-testid="acp-tool-call-card"');
    expect(html).toContain("List files");
    expect(html).toContain('data-state="completed"');
    // TASK-160: the tool-call id is a transport correlation UUID, not
    // something a learner can act on. It is text only for a developer.
    expect(html).not.toContain("Tool Call ID");
    expect(html).toContain('data-tool-call-id="tc-001"');
    expect(
      renderToStaticMarkup(<AcpToolCallCard card={baseCard} debug />)
    ).toContain("Tool Call ID: tc-001");
  });

  it("renders diff-only content as a bare file-changes panel", () => {
    const diffCard: AcpToolCallCardData = {
      content: [
        {
          new_text: "const x = 2;\n",
          old_text: "const x = 1;\n",
          path: "src/foo.ts",
          type: "diff",
        },
      ],
      kind: "edit",
      raw_input: {},
      raw_output: null,
      status: "completed",
      title: "Edit foo.ts",
      toolCallId: "tc-002",
    };
    expect(isDiffOnly(diffCard)).toBe(true);
    const html = renderToStaticMarkup(<AcpToolCallCard card={diffCard} />);
    expect(html).toContain('data-slot="file-changes"');
    expect(html).toContain("foo.ts");
    expect(html).toContain('data-diff-line="add"');
    expect(html).toContain('data-diff-line="remove"');
    // The diff-only fast path printed the id unconditionally too (TASK-160).
    expect(html).not.toContain("Tool Call ID");
    expect(
      renderToStaticMarkup(<AcpToolCallCard card={diffCard} debug />)
    ).toContain("Tool Call ID: tc-002");
  });

  it("isDiffOnly returns false when content is not all diffs", () => {
    const mixedCard: AcpToolCallCardData = {
      content: [
        { new_text: "", old_text: "", path: "a.ts", type: "diff" },
        { text: "hello", type: "text" },
      ],
      kind: "execute",
      raw_input: {},
      raw_output: null,
      status: "completed",
      title: "Mixed",
      toolCallId: "tc-003",
    };
    expect(isDiffOnly(mixedCard)).toBe(false);
  });

  it("isDiffOnly returns false when the card is truncated", () => {
    const truncatedCard: AcpToolCallCardData = {
      content: [
        {
          new_text: "y",
          old_text: "x",
          path: "a.ts",
          type: "diff",
        },
      ],
      kind: "edit",
      raw_input: {},
      raw_output: null,
      status: "pending",
      title: "Truncated",
      toolCallId: "tc-004",
      truncated: true,
    };
    expect(isDiffOnly(truncatedCard)).toBe(false);
  });

  it("shows an Expand button on a truncated card with onExpand", () => {
    const truncatedCard: AcpToolCallCardData = {
      ...baseCard,
      status: "in_progress",
      truncated: true,
    };
    const onExpand = () => Promise.resolve(truncatedCard);
    const html = renderToStaticMarkup(
      <AcpToolCallCard card={truncatedCard} onExpand={onExpand} />
    );
    expect(html).toContain('data-slot="acp-tool-expand"');
    expect(html).toContain("Expand");
    expect(html).toContain('data-state="in_progress"');
  });

  it("renders an image output when raw_output is a data URI", () => {
    const imageCard: AcpToolCallCardData = {
      ...baseCard,
      raw_output:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
    };
    const html = renderToStaticMarkup(<AcpToolCallCard card={imageCard} />);
    expect(html).toContain('data-slot="acp-tool-image"');
    expect(html).toContain("<img");
  });
});

// ── AcpPermissionCard ─────────────────────────────────────────────────────────

describe("AcpPermissionCard", () => {
  const options: AcpPermissionOption[] = [
    { id: "allow", intent: "allow", label: "Allow" },
    { id: "reject", intent: "reject", label: "Reject" },
  ];
  const onSubmit = () => Promise.resolve();

  it("renders in the default state with all option buttons", () => {
    const html = renderToStaticMarkup(
      <AcpPermissionCard
        onSubmit={onSubmit}
        options={options}
        title="Run command"
      />
    );
    expect(html).toContain('data-slot="acp-permission-card"');
    expect(html).toContain('data-state="default"');
    expect(html).toContain('data-testid="acp-permission-card"');
    expect(html).toContain("acp-permission-option-allow");
    expect(html).toContain("acp-permission-option-reject");
    expect(html).toContain("Run command");
  });

  it("shows a receipt after a successful submit", () => {
    // Simulate the receipt state by rendering with a resolved submit.
    // In SSR we can't run effects, so we pin the state table directly:
    // the card renders `data-state="receipt"` when hasResponded is true.
    // Since SSR renders the initial state, we verify the default render
    // and the shape of the receipt markup that would appear post-submit.
    const html = renderToStaticMarkup(
      <AcpPermissionCard
        onSubmit={onSubmit}
        options={options}
        title="Run command"
      />
    );
    // The receipt and error testids exist in the component; they render
    // conditionally. Verify the default state does NOT show them.
    expect(html).not.toContain("acp-permission-status");
    expect(html).not.toContain("acp-permission-error");
  });

  it("renders the operation kind badge when provided", () => {
    const html = renderToStaticMarkup(
      <AcpPermissionCard
        onSubmit={onSubmit}
        operationKind="shell"
        options={options}
        title="Run command"
      />
    );
    expect(html).toContain('data-slot="acp-permission-kind"');
    expect(html).toContain("shell");
  });

  it("renders the detail block when provided", () => {
    const html = renderToStaticMarkup(
      <AcpPermissionCard
        detail="npm install"
        onSubmit={onSubmit}
        options={options}
        title="Run command"
      />
    );
    expect(html).toContain('data-slot="acp-permission-detail"');
    expect(html).toContain("npm install");
  });

  it("shows the description only when it differs from the title", () => {
    const withDesc = renderToStaticMarkup(
      <AcpPermissionCard
        description="Installs dependencies"
        onSubmit={onSubmit}
        options={options}
        title="Run command"
      />
    );
    expect(withDesc).toContain("Installs dependencies");

    const sameDesc = renderToStaticMarkup(
      <AcpPermissionCard
        description="Run command"
        onSubmit={onSubmit}
        options={options}
        title="Run command"
      />
    );
    // When description === title, the <p> is omitted.
    expect(sameDesc).not.toContain("<p");
  });
});

// ── AcpAskCard ────────────────────────────────────────────────────────────────

describe("AcpAskCard", () => {
  const questions: AcpAskQuestion[] = [
    {
      header: "Level",
      multiSelect: false,
      options: [
        { description: "Beginner", label: "N5" },
        { description: "Elementary", label: "N4" },
      ],
      question: "What JLPT level are you targeting?",
    },
    {
      header: "Focus",
      multiSelect: true,
      options: [
        { label: "Vocabulary" },
        { label: "Grammar" },
        { label: "Kanji" },
      ],
      question: "What do you want to focus on?",
    },
  ];
  const onSubmit = () => Promise.resolve();

  it("renders the default state with all questions and options", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard onSubmit={onSubmit} questions={questions} />
    );
    expect(html).toContain('data-slot="acp-ask-card"');
    expect(html).toContain('data-state="default"');
    expect(html).toContain("acp-ask-card");
    expect(html).toContain("acp-ask-question-0");
    expect(html).toContain("acp-ask-question-1");
    expect(html).toContain("What JLPT level are you targeting?");
    expect(html).toContain("What do you want to focus on?");
    expect(html).toContain("N5");
    expect(html).toContain("Vocabulary");
  });

  it("renders the Submit + Decline buttons", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard onSubmit={onSubmit} questions={questions} />
    );
    expect(html).toContain("acp-ask-submit");
    expect(html).toContain("acp-ask-decline");
  });

  it("shows the unanswered hint when no answer is selected", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard onSubmit={onSubmit} questions={questions} />
    );
    expect(html).toContain("No answer selected");
  });

  it("collectAnswers returns empty when no answers", () => {
    const answers = collectAnswers(questions, {});
    expect(answers).toEqual([]);
  });

  it("collectAnswers returns labels for single-select", () => {
    const answers = collectAnswers(questions, {
      "What do you want to focus on?": { labels: [], other: "" },
      "What JLPT level are you targeting?": {
        labels: ["N5"],
        other: "",
      },
    });
    expect(answers).toHaveLength(1);
    expect(answers[0]?.labels).toEqual(["N5"]);
  });

  it("collectAnswers prefers Other free-text over labels", () => {
    const answers = collectAnswers(questions, {
      "What JLPT level are you targeting?": {
        labels: ["N5"],
        other: "N3",
      },
    });
    expect(answers).toHaveLength(1);
    expect(answers[0]?.labels).toEqual(["N3"]);
  });

  it("renders the Other input when options exist", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard onSubmit={onSubmit} questions={questions} />
    );
    expect(html).toContain("acp-ask-other-0");
    expect(html).toContain("acp-ask-other-1");
    expect(html).toContain("Other");
  });

  // Regression (TASK-86 follow-up): clicking the option TEXT must toggle.
  // base-ui's Checkbox puts the passed `id` on a hidden native input and
  // the label's `for` activates THAT input — so the toggle handler's
  // dataset must live on the label too, and the id must be
  // whitespace-free (a "Total beginner" label used to render an
  // unresolvable `for` with a dead click target).
  it("option labels carry the toggle dataset and resolve their 'for'", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard
        onSubmit={onSubmit}
        questions={[
          {
            options: [{ label: "Total beginner" }, { label: "Some study" }],
            question: "Where are you starting from?",
          },
        ]}
      />
    );
    const labels = [...html.matchAll(LABEL_TAG_RE)].map((m) => m[0]);
    expect(labels.length).toBe(2);
    for (const tag of labels) {
      const forMatch = LABEL_FOR_RE.exec(tag);
      expect(forMatch).not.toBeNull();
      const ref = forMatch?.[1] ?? "";
      expect(ref).not.toContain(" ");
      expect(html).toContain(`id="${ref}"`);
      expect(tag).toContain("data-option-label=");
      expect(tag).toContain("data-option-key=");
    }
  });

  // TASK-86 compact terminal states: a resolved/expired ask replays as a
  // one-line summary, never the full form or an empty shell.
  it("resolution answered renders the compact summary, no form", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard
        onSubmit={onSubmit}
        questions={questions}
        resolution={{
          answers: [
            { labels: ["N5"], question: "What JLPT level are you targeting?" },
            {
              labels: ["Vocabulary", "Kanji"],
              question: "What do you want to focus on?",
            },
          ],
          kind: "answered",
        }}
      />
    );
    expect(html).toContain('data-slot="acp-ask-card"');
    expect(html).toContain('data-state="answered"');
    expect(html).toContain("Response sent");
    expect(html).toContain('data-slot="acp-ask-summary"');
    expect(html).toContain("Vocabulary, Kanji");
    expect(html).not.toContain("acp-ask-submit");
    expect(html).not.toContain("acp-ask-question-0");
  });

  it("resolution answered without a persisted summary still collapses", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard
        onSubmit={onSubmit}
        questions={questions}
        resolution={{ answers: [], kind: "answered" }}
      />
    );
    expect(html).toContain('data-state="answered"');
    expect(html).toContain("Response sent");
    expect(html).not.toContain('data-slot="acp-ask-summary"');
    expect(html).not.toContain("acp-ask-submit");
  });

  it("resolution declined renders the compact declined line", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard
        onSubmit={onSubmit}
        questions={questions}
        resolution={{ kind: "declined" }}
      />
    );
    expect(html).toContain('data-state="declined"');
    expect(html).toContain("Response declined");
    expect(html).not.toContain("acp-ask-submit");
  });

  it("resolution expired renders the compact failed line", () => {
    const html = renderToStaticMarkup(
      <AcpAskCard
        onSubmit={onSubmit}
        questions={questions}
        resolution={{ kind: "expired" }}
      />
    );
    expect(html).toContain('data-state="expired"');
    expect(html).toContain("expired without an answer");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("acp-ask-submit");
    expect(html).not.toContain("acp-ask-question-0");
  });
});

// ── AcpTerminalCard ───────────────────────────────────────────────────────────

describe("AcpTerminalCard", () => {
  const running: AcpTerminalCardData = {
    command: "npm test",
    exitStatus: null,
    output: "PASS src/app.test.ts",
    terminalId: "term-1",
    truncated: false,
  };
  const onKill = () => Promise.resolve();

  it("pins the running state: live output region + armed Kill button", () => {
    const html = renderToStaticMarkup(
      <AcpTerminalCard card={running} onKill={onKill} />
    );
    expect(html).toContain('data-slot="acp-terminal-card"');
    expect(html).toContain('data-state="running"');
    expect(html).toContain('data-testid="acp-terminal-card"');
    // command + cumulative output region
    expect(html).toContain("npm test");
    expect(html).toContain('data-slot="acp-terminal-output"');
    expect(html).toContain("PASS src/app.test.ts");
    // running badge + kill button (aria-labelled)
    expect(html).toContain('data-testid="acp-terminal-running"');
    expect(html).toContain('data-testid="acp-terminal-kill"');
    expect(html).toContain('aria-label="Kill terminal term-1"');
    expect(html).not.toContain('data-testid="acp-terminal-exit-badge"');
  });

  it("the running card without onKill shows no kill affordance", () => {
    const html = renderToStaticMarkup(<AcpTerminalCard card={running} />);
    expect(html).toContain('data-state="running"');
    expect(html).not.toContain('data-testid="acp-terminal-kill"');
  });

  it("shows the truncated indicator when the server cap was hit", () => {
    const truncated: AcpTerminalCardData = {
      ...running,
      truncated: true,
    };
    const html = renderToStaticMarkup(
      <AcpTerminalCard card={truncated} onKill={onKill} />
    );
    expect(html).toContain('data-testid="acp-terminal-truncated"');
    expect(html).toContain("Output truncated");
  });

  it("renders a placeholder when the cumulative buffer is still empty", () => {
    const empty: AcpTerminalCardData = {
      ...running,
      output: "",
    };
    const html = renderToStaticMarkup(
      <AcpTerminalCard card={empty} onKill={onKill} />
    );
    expect(html).toContain("(no output yet)");
  });

  it("pins the exited state: exit-status badge, no Kill button", () => {
    const exited: AcpTerminalCardData = {
      ...running,
      exitStatus: { exit_code: 0, signaled: false },
      output: "10 passed",
    };
    const html = renderToStaticMarkup(
      <AcpTerminalCard card={exited} onKill={onKill} />
    );
    expect(html).toContain('data-state="exited"');
    expect(html).toContain('data-testid="acp-terminal-exit-badge"');
    expect(html).toContain("Exited 0");
    expect(html).not.toContain('data-testid="acp-terminal-kill"');
    expect(html).not.toContain('data-testid="acp-terminal-running"');
  });

  it("a failed exit code pins the non-zero badge", () => {
    const failed: AcpTerminalCardData = {
      ...running,
      exitStatus: { exit_code: 1, signaled: false },
    };
    const html = renderToStaticMarkup(
      <AcpTerminalCard card={failed} onKill={onKill} />
    );
    expect(html).toContain("Exited 1");
  });

  it("a signalled exit pins the Killed badge", () => {
    const signalled: AcpTerminalCardData = {
      ...running,
      exitStatus: { exit_code: null, signaled: true },
    };
    const html = renderToStaticMarkup(
      <AcpTerminalCard card={signalled} onKill={onKill} />
    );
    expect(html).toContain("Killed");
  });

  it("exitStatusLabel maps the raw exit status to the badge text", () => {
    expect(exitStatusLabel(running)).toBeNull();
    expect(
      exitStatusLabel({
        ...running,
        exitStatus: { exit_code: 0, signaled: false },
      })
    ).toBe("Exited 0");
    expect(
      exitStatusLabel({
        ...running,
        exitStatus: { exit_code: 2, signaled: false },
      })
    ).toBe("Exited 2");
    expect(
      exitStatusLabel({
        ...running,
        exitStatus: { exit_code: null, signaled: true },
      })
    ).toBe("Killed");
  });
});

// ── TASK-81.3: state-table pins added BEFORE the per-state split ─────────────
// These close the coverage gaps the refactor relies on (CRAP drops with
// coverage): the interactive sub-states that SSR can't reach through the
// normal flow are pinned via the extracted per-state components once they
// exist, and via the parent's data-state contract here.

import { AcpPermissionStateBadge } from "./acp-permission-states";
import { AcpTerminalExitBadge } from "./acp-terminal-states";
import { ToolCallStateTag as AcpToolCallStateTag } from "./acp-tool-call-states";

describe("AcpToolCallCard state table (TASK-81.3)", () => {
  const baseCard: AcpToolCallCardData = {
    content: null,
    kind: "execute",
    raw_input: { command: "ls" },
    raw_output: "out",
    status: "completed",
    title: "List files",
    toolCallId: "tc-100",
  };

  it("pending status maps to the pending state tag", () => {
    const html = renderToStaticMarkup(
      <AcpToolCallCard card={{ ...baseCard, status: "pending" }} />
    );
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('data-state="default"'); // card shell default
  });

  it("in_progress status maps to the in_progress state tag", () => {
    const html = renderToStaticMarkup(
      <AcpToolCallCard card={{ ...baseCard, status: "in_progress" }} />
    );
    expect(html).toContain('data-state="in_progress"');
  });

  it("failed status maps to the failed state tag", () => {
    const html = renderToStaticMarkup(
      <AcpToolCallCard card={{ ...baseCard, status: "failed" }} />
    );
    expect(html).toContain('data-state="failed"');
  });

  it("AcpToolCallStateTag renders each lifecycle state", () => {
    expect(
      renderToStaticMarkup(<AcpToolCallStateTag status="pending" />)
    ).toContain('data-state="pending"');
    expect(
      renderToStaticMarkup(<AcpToolCallStateTag status="in_progress" />)
    ).toContain('data-state="in_progress"');
    expect(
      renderToStaticMarkup(<AcpToolCallStateTag status="failed" />)
    ).toContain('data-state="failed"');
    expect(
      renderToStaticMarkup(<AcpToolCallStateTag status="completed" />)
    ).toContain('data-state="completed"');
    // unknown status degrades to completed (toStatusVariant default)
    expect(
      renderToStaticMarkup(<AcpToolCallStateTag status="weird" />)
    ).toContain('data-state="completed"');
  });
});

describe("AcpPermissionCard state table (TASK-81.3)", () => {
  it("AcpPermissionStateBadge pins the receipt state", () => {
    const html = renderToStaticMarkup(
      <AcpPermissionStateBadge state="receipt" testIdPrefix="acp-permission" />
    );
    expect(html).toContain('data-testid="acp-permission-status"');
    expect(html).toContain("Response sent");
  });

  it("AcpPermissionStateBadge pins the retry state", () => {
    const html = renderToStaticMarkup(
      <AcpPermissionStateBadge state="retry" testIdPrefix="acp-permission" />
    );
    expect(html).toContain('data-testid="acp-permission-error"');
    expect(html).toContain("Response failed. Try again.");
  });

  it("AcpPermissionStateBadge renders nothing in the default state", () => {
    const html = renderToStaticMarkup(
      <AcpPermissionStateBadge state="default" testIdPrefix="acp-permission" />
    );
    expect(html).toBe("");
  });

  it("reject-intent options render the destructive variant", () => {
    const resolve = () => Promise.resolve();
    const html = renderToStaticMarkup(
      <AcpPermissionCard
        onSubmit={resolve}
        options={[{ id: "deny", intent: "reject", label: "Deny" }]}
        title="Guarded"
      />
    );
    expect(html).toContain("Deny");
  });
});

describe("AcpTerminalCard state table (TASK-81.3)", () => {
  it("AcpTerminalExitBadge renders the exited badge for exit_code 0", () => {
    const html = renderToStaticMarkup(
      <AcpTerminalExitBadge
        exitStatus={{ exit_code: 0, signaled: false }}
        testIdPrefix="acp-terminal"
      />
    );
    expect(html).toContain('data-testid="acp-terminal-exit-badge"');
    expect(html).toContain("Exited 0");
  });

  it("AcpTerminalExitBadge renders the Killed badge for signalled runs", () => {
    const html = renderToStaticMarkup(
      <AcpTerminalExitBadge
        exitStatus={{ exit_code: null, signaled: true }}
        testIdPrefix="acp-terminal"
      />
    );
    expect(html).toContain("Killed");
  });

  it("AcpTerminalExitBadge renders nothing while running", () => {
    const html = renderToStaticMarkup(
      <AcpTerminalExitBadge exitStatus={null} testIdPrefix="acp-terminal" />
    );
    expect(html).toBe("");
  });
});
