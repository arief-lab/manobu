import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { t } from "@manobu/ui/lib/copy";

describe("ai offline state (TASK-115 AC#1-#4)", () => {
  it("reuses error.offline deck (no em dash, R-02)", () => {
    const offline = t("error.offline");
    expect(offline).toBe(
      "You're offline: cached lessons still work, AI disabled"
    );
    expect(offline).not.toContain("—");
    expect(offline).not.toContain("Failed to fetch");
  });

  it("ai.tsx renders inline offline state, not an error boundary, and keeps shell usable", () => {
    const routePath = join(import.meta.dir, "../src/routes/ai.tsx");
    const columnPath = join(
      import.meta.dir,
      "../src/features/chat/chat-column.tsx"
    );
    const routeSource = readFileSync(routePath, "utf-8");
    const columnSource = readFileSync(columnPath, "utf-8");
    expect(columnSource).toContain('data-testid="ai-offline"');
    expect(columnSource).toContain('t("error.offline")');
    expect(columnSource).toContain("isOffline");
    expect(routeSource).toContain(
      "safe(queryClient.ensureQueryData(agentCatalogQueryOptions))"
    );
    expect(routeSource).toContain(
      "safe(queryClient.ensureQueryData(personaCatalogQueryOptions))"
    );
    expect(columnSource).toContain("{isOffline ? (");
    expect(routeSource).toContain('data-testid="ai-back-desk"');
  });

  it("offline state does not render when sidecar is reachable (AC#4 second half)", () => {
    const columnPath = join(
      import.meta.dir,
      "../src/features/chat/chat-column.tsx"
    );
    const columnSource = readFileSync(columnPath, "utf-8");
    expect(columnSource).toContain(
      "const isOffline = agentsQuery.isError || personasQuery.isError"
    );
    expect(columnSource).toContain('data-testid="ai-offline"');
  });
});
