/**
 * The identity battery every composed 読解 gate runs on a row: the pipeline
 * signature, the validated flag, the judge record and the provenance tag. The
 * screens behind these are ONE shared contract (`certIssues` in
 * `scripts/check-reading-shared.ts`), so the proofs live in one place too.
 * Each gate passes its own battery: the typed fixture and the `checkEntry`
 * wrapper differ per 大問, and wiring THIS gate to the shared screens is what
 * each battery still proves.
 */

import { expect, it } from "bun:test";
import type { CertFields } from "../scripts/check-reading-shared";

/** The identity fields the battery tampers with, typed so every 大問's
 * `withEntry` accepts them: the union members the screens name as refusals. */
export type IdentityPatch = Pick<
  CertFields,
  "provenance" | "validated" | "validatedBy"
> & {
  readonly sourceIds?: readonly string[];
};

export interface IdentityBattery<T extends { readonly id: string }> {
  readonly base: T;
  readonly gate: (
    entry: T,
    rejections: ReadonlySet<string>
  ) => readonly string[];
  readonly tamper: (patch: IdentityPatch) => T;
}

export const identityRejectionTests = <T extends { readonly id: string }>({
  base,
  gate,
  tamper,
}: IdentityBattery<T>): void => {
  it("rejects a row that lost its pipeline signature", () => {
    expect(
      gate(tamper({ validatedBy: "opencode:some-model" }), new Set())
    ).toContain("validatedBy-missing-or-bad-form");
  });

  it("rejects a row that lost its validated flag", () => {
    expect(gate(tamper({ validated: false }), new Set())).toContain(
      "not-validated"
    );
  });

  it("rejects a row the judge recorded as ambiguous", () => {
    expect(gate(base, new Set([base.id]))).toContain("row-judge-rejected");
  });

  it("rejects a row whose provenance stopped being composed", () => {
    expect(gate(tamper({ provenance: "licensed" }), new Set())).toContain(
      "provenance-not-composed"
    );
  });
};

/** The single-source link screen, run only by the gates whose rows cite exactly
 * one document. 統合理解 pairs cite two and 長文 windows cite their window
 * key, so their stores never take this battery. */
export const sourceLinkRejectionTest = <T extends { readonly id: string }>({
  gate,
  tamper,
}: IdentityBattery<T>): void => {
  it("rejects a broken source link", () => {
    expect(gate(tamper({ sourceIds: [] }), new Set())).toContain(
      "sourceIds-not-single"
    );
    expect(gate(tamper({ sourceIds: ["missing"] }), new Set())).toContain(
      "sourceId-unknown"
    );
  });
};
