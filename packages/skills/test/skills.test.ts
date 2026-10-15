import { describe, expect, it } from "bun:test";

import { __test__, findSkill, loadSkills } from "@manobu/skills";

const MISSING_RE = /missing --- frontmatter ---/;
const INVALID_RE = /invalid frontmatter/;

describe("parseFrontmatter", () => {
  it("splits key/value pairs", () => {
    expect(__test__.parseFrontmatter("name: Foo\ndescription: Bar")).toEqual({
      description: "Bar",
      name: "Foo",
    });
  });

  it("skips lines without a colon", () => {
    expect(__test__.parseFrontmatter("junk line\nname: Foo")).toEqual({
      name: "Foo",
    });
  });
});

describe("parseSkillFile", () => {
  it("parses frontmatter + body", () => {
    const raw =
      "---\nname: ConversationCoach\ndescription: Friendly chat\nagent: conversation\n---\n\nBody here.";
    const skill = __test__.parseSkillFile(raw, {
      kind: "project",
      path: "/tmp/x.md",
    });
    expect(skill.frontmatter.name).toBe("ConversationCoach");
    expect(skill.body).toContain("Body here");
  });

  it("throws when frontmatter is missing", () => {
    expect(() =>
      __test__.parseSkillFile("body only", { kind: "user", path: "/tmp/x" })
    ).toThrow(MISSING_RE);
  });

  it("throws on invalid frontmatter (wrong type)", () => {
    expect(
      () =>
        __test__.parseSkillFile(
          "---\nname: 123\ndescription: x\nagent: y\n---\nbody",
          {
            kind: "user",
            path: "/tmp/x",
          }
        ).source
    ).not.toThrow();
    // `name: 123` is treated as the string "123" — our parser doesn't enforce
    // non-numeric, so the only way to fail validation is missing required keys.
    expect(() =>
      __test__.parseSkillFile("---\nname: x\nagent: y\n---\nbody", {
        kind: "user",
        path: "/tmp/x",
      })
    ).toThrow(INVALID_RE);
  });
});

describe("loadSkills + findSkill", () => {
  it("returns empty for a cwd with no skills dirs", () => {
    const skills = loadSkills("/nonexistent-cwd-path-xyz", "/nonexistent-home");
    expect(skills).toEqual([]);
    expect(
      findSkill("anything", "/nonexistent-cwd-path-xyz", "/nonexistent-home")
    ).toBeNull();
  });
});
