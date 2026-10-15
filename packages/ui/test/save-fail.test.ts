import { describe, expect, it } from "bun:test";

import { t } from "@manobu/ui/lib/copy";

describe("save-fail copy wiring", () => {
  it("review.save_toast.error mentions Retry + Export backup (Zbbf2)", () => {
    const msg = t("review.save_toast.error");
    expect(msg).toContain("Retry");
    expect(msg.toLowerCase()).toContain("export");
  });

  it("mock.submit.fail covers both submit failure paths (FSRS write fail + WAL saved)", () => {
    const msg = t("mock.submit.fail");
    expect(msg.toLowerCase()).toContain("fsrs");
    expect(msg).toContain("Retry");
    expect(msg.toLowerCase()).toContain("progress");
  });

  it("error.disk_full provides Free space + Continue offline (k7SrUT)", () => {
    const msg = t("error.disk_full");
    expect(msg.toLowerCase()).toContain("disk");
    expect(msg).toContain("Free space");
    expect(msg).toContain("Continue offline");
  });

  it("error.download supports resume after pause (qd6N1)", () => {
    const msg = t("error.download");
    expect(msg).toContain("resume");
    expect(msg).toContain("Retry");
  });

  it("error.audio supports [Re-download][Continue offline] (UUIuC)", () => {
    const msg = t("error.audio");
    expect(msg).toContain("Re-download");
    expect(msg).toContain("Continue offline");
  });

  it("error.offline names what still works (cypfU)", () => {
    const msg = t("error.offline");
    expect(msg.toLowerCase()).toContain("offline");
    expect(msg.toLowerCase()).toContain("cached");
  });
});
