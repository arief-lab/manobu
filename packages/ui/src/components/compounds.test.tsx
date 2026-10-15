/**
 * Namespaced-compound smoke suite (vercel-composition-patterns, rule 2).
 *
 * The wrap is *mechanical*: every namespaced subpart IS the same function
 * reference as the flat export, so DOM produced via `<Card.Header>` IS the
 * same DOM produced via `<CardHeader>`. These tests pin that contract at
 * three levels:
 *
 *   1. Reference equality — namespace path resolves to the same function.
 *   2. SSR DOM equality — namespace path renders byte-equal markup.
 *   3. Composed-tree equality — namespace path inside its own parent renders
 *      the same combined tree as the flat path inside the same parent.
 *
 * MessageScroller's subparts are intentionally skipped from the SSR block —
 * each maps to a `<MessageScrollerPrimitive.X>` which expects a provider
 * context at the parent. Reference equality is still asserted for them.
 *
 * Plus a `rule-8 (react19-no-forwardref)` block that pins the migration of
 * context reads to React 19's `use()`: no `useContext(` callsites, no
 * `forwardRef(`, and `useToolRenderers()` actually reads through `use(RendererContext)`.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "./attachment";
import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from "./bubble";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group";
import { Marker, MarkerContent, MarkerIcon } from "./marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "./message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "./message-scroller";
import { ToolRendererProvider, useToolRenderers } from "./tool-call-card";

/** Helper: render <Compound />  vs  <Flat /> with the same children and assert byte equality. */
function assertSameDom(
  Compound: FunctionComponent<{ children?: React.ReactNode }>,
  Flat: FunctionComponent<{ children?: React.ReactNode }>,
  children: React.ReactNode = "x"
) {
  const a = renderToStaticMarkup(createElement(Compound, null, children));
  const b = renderToStaticMarkup(createElement(Flat, null, children));
  expect(a).toBe(b);
}

describe("namespaced compounds are reference-equal to flat exports", () => {
  test("Card.*", () => {
    expect(Card.Header).toBe(CardHeader);
    expect(Card.Title).toBe(CardTitle);
    expect(Card.Description).toBe(CardDescription);
    expect(Card.Content).toBe(CardContent);
    expect(Card.Action).toBe(CardAction);
    expect(Card.Footer).toBe(CardFooter);
  });
  test("Empty.*", () => {
    expect(Empty.Header).toBe(EmptyHeader);
    expect(Empty.Title).toBe(EmptyTitle);
    expect(Empty.Description).toBe(EmptyDescription);
    expect(Empty.Content).toBe(EmptyContent);
    expect(Empty.Media).toBe(EmptyMedia);
  });
  test("Bubble.*", () => {
    expect(Bubble.Content).toBe(BubbleContent);
    expect(Bubble.Group).toBe(BubbleGroup);
    expect(Bubble.Reactions).toBe(BubbleReactions);
  });
  test("Message.*", () => {
    expect(Message.Group).toBe(MessageGroup);
    expect(Message.Avatar).toBe(MessageAvatar);
    expect(Message.Content).toBe(MessageContent);
    expect(Message.Header).toBe(MessageHeader);
    expect(Message.Footer).toBe(MessageFooter);
  });
  test("MessageScroller.*", () => {
    expect(MessageScroller.Provider).toBe(MessageScrollerProvider);
    expect(MessageScroller.Viewport).toBe(MessageScrollerViewport);
    expect(MessageScroller.Content).toBe(MessageScrollerContent);
    expect(MessageScroller.Item).toBe(MessageScrollerItem);
    expect(MessageScroller.Button).toBe(MessageScrollerButton);
  });
  test("Marker.*", () => {
    expect(Marker.Icon).toBe(MarkerIcon);
    expect(Marker.Content).toBe(MarkerContent);
  });
  test("Attachment.*", () => {
    expect(Attachment.Media).toBe(AttachmentMedia);
    expect(Attachment.Content).toBe(AttachmentContent);
    expect(Attachment.Title).toBe(AttachmentTitle);
    expect(Attachment.Description).toBe(AttachmentDescription);
    expect(Attachment.Actions).toBe(AttachmentActions);
    expect(Attachment.Action).toBe(AttachmentAction);
    expect(Attachment.Trigger).toBe(AttachmentTrigger);
    expect(Attachment.Group).toBe(AttachmentGroup);
  });
  test("InputGroup.*", () => {
    expect(InputGroup.Addon).toBe(InputGroupAddon);
    expect(InputGroup.Button).toBe(InputGroupButton);
    expect(InputGroup.Text).toBe(InputGroupText);
    expect(InputGroup.Input).toBe(InputGroupInput);
    expect(InputGroup.Textarea).toBe(InputGroupTextarea);
  });
});

describe("namespaced compounds render byte-equal DOM", () => {
  test("Card.Header / CardHeader", () =>
    assertSameDom(Card.Header, CardHeader));
  test("Card.Title / CardTitle", () => assertSameDom(Card.Title, CardTitle));
  test("Card.Description / CardDescription", () =>
    assertSameDom(Card.Description, CardDescription));
  test("Card.Content / CardContent", () =>
    assertSameDom(Card.Content, CardContent));
  test("Card.Action / CardAction", () =>
    assertSameDom(Card.Action, CardAction));
  test("Card.Footer / CardFooter", () =>
    assertSameDom(Card.Footer, CardFooter));

  test("Empty.Header / EmptyHeader", () =>
    assertSameDom(Empty.Header, EmptyHeader));
  test("Empty.Title / EmptyTitle", () =>
    assertSameDom(Empty.Title, EmptyTitle));
  test("Empty.Description / EmptyDescription", () =>
    assertSameDom(Empty.Description, EmptyDescription));
  test("Empty.Content / EmptyContent", () =>
    assertSameDom(Empty.Content, EmptyContent));
  test("Empty.Media / EmptyMedia", () =>
    assertSameDom(Empty.Media, EmptyMedia));

  test("Bubble.Content / BubbleContent", () =>
    assertSameDom(Bubble.Content, BubbleContent));
  test("Bubble.Group / BubbleGroup", () =>
    assertSameDom(Bubble.Group, BubbleGroup));
  test("Bubble.Reactions / BubbleReactions", () =>
    assertSameDom(Bubble.Reactions, BubbleReactions));

  test("Message.Group / MessageGroup", () =>
    assertSameDom(Message.Group, MessageGroup));
  test("Message.Avatar / MessageAvatar", () =>
    assertSameDom(Message.Avatar, MessageAvatar));
  test("Message.Content / MessageContent", () =>
    assertSameDom(Message.Content, MessageContent));
  test("Message.Header / MessageHeader", () =>
    assertSameDom(Message.Header, MessageHeader));
  test("Message.Footer / MessageFooter", () =>
    assertSameDom(Message.Footer, MessageFooter));

  test("Marker.Icon / MarkerIcon", () =>
    assertSameDom(Marker.Icon, MarkerIcon));
  test("Marker.Content / MarkerContent", () =>
    assertSameDom(Marker.Content, MarkerContent));

  test("Attachment.Media / AttachmentMedia", () =>
    assertSameDom(Attachment.Media, AttachmentMedia));
  test("Attachment.Content / AttachmentContent", () =>
    assertSameDom(Attachment.Content, AttachmentContent));
  test("Attachment.Title / AttachmentTitle", () =>
    assertSameDom(Attachment.Title, AttachmentTitle));
  test("Attachment.Description / AttachmentDescription", () =>
    assertSameDom(Attachment.Description, AttachmentDescription));
  test("Attachment.Actions / AttachmentActions", () =>
    assertSameDom(Attachment.Actions, AttachmentActions, null));
  test("Attachment.Action / AttachmentAction", () =>
    assertSameDom(Attachment.Action, AttachmentAction, null));
  test("Attachment.Trigger / AttachmentTrigger", () =>
    assertSameDom(Attachment.Trigger, AttachmentTrigger, null));
  test("Attachment.Group / AttachmentGroup", () =>
    assertSameDom(Attachment.Group, AttachmentGroup, null));

  test("InputGroup.Addon / InputGroupAddon", () =>
    assertSameDom(InputGroup.Addon, InputGroupAddon));
  test("InputGroup.Button / InputGroupButton", () =>
    assertSameDom(InputGroup.Button, InputGroupButton, null));
  test("InputGroup.Text / InputGroupText", () =>
    assertSameDom(InputGroup.Text, InputGroupText));
  test("InputGroup.Input / InputGroupInput", () =>
    assertSameDom(InputGroup.Input, InputGroupInput, null));
  test("InputGroup.Textarea / InputGroupTextarea", () =>
    assertSameDom(InputGroup.Textarea, InputGroupTextarea, null));
});

describe("composed parent trees render byte-equally via flat vs namespaced API", () => {
  test("Card: <Card><Card.Header><Card.Title /><Card.Description /></Card.Header><Card.Content /></Card>", () => {
    const flat = renderToStaticMarkup(
      <Card size="sm">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>
    );
    const compound = renderToStaticMarkup(
      <Card size="sm">
        <Card.Header>
          <Card.Title>Title</Card.Title>
          <Card.Description>Desc</Card.Description>
        </Card.Header>
        <Card.Content>Body</Card.Content>
        <Card.Footer>Foot</Card.Footer>
      </Card>
    );
    expect(compound).toBe(flat);
  });

  test("Empty: <Empty><Empty.Media /><Empty.Header><Empty.Title /><Empty.Description /></Empty.Header><Empty.Content /></Empty>", () => {
    const flat = renderToStaticMarkup(
      <Empty>
        <EmptyMedia variant="icon" />
        <EmptyHeader>
          <EmptyTitle>Title</EmptyTitle>
          <EmptyDescription>Desc</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>Body</EmptyContent>
      </Empty>
    );
    const compound = renderToStaticMarkup(
      <Empty>
        <Empty.Media variant="icon" />
        <Empty.Header>
          <Empty.Title>Title</Empty.Title>
          <Empty.Description>Desc</Empty.Description>
        </Empty.Header>
        <Empty.Content>Body</Empty.Content>
      </Empty>
    );
    expect(compound).toBe(flat);
  });

  test("Message: <Message><Message.Avatar /><Message.Content><Message.Header /><Message.Footer /></Message.Content></Message>", () => {
    const flat = renderToStaticMarkup(
      <Message align="end">
        <MessageAvatar>A</MessageAvatar>
        <MessageContent>
          <MessageHeader>header</MessageHeader>
          Body
          <MessageFooter>foot</MessageFooter>
        </MessageContent>
      </Message>
    );
    const compound = renderToStaticMarkup(
      <Message align="end">
        <Message.Avatar>A</Message.Avatar>
        <Message.Content>
          <Message.Header>header</Message.Header>
          Body
          <Message.Footer>foot</Message.Footer>
        </Message.Content>
      </Message>
    );
    expect(compound).toBe(flat);
  });
});

// --------------------------------------------------------------------------
// rule-8 (react19-no-forwardref) — `use()` instead of `useContext()`
// --------------------------------------------------------------------------

/**
 * Walk `packages/ui/src` and return the absolute path of every `.ts` /
 * `.tsx` source file. Walks recursively; skips nothing. The
 * `resolve("../../src", import.meta.url)` line works because this
 * test lives at `packages/ui/src/components/compounds.test.tsx` and
 * runs with `bun test` invoked from `packages/ui` — `../../src` of
 * `src/components` is `packages/ui/src`.
 */
const UI_SRC = resolve(new URL("../../src", import.meta.url).pathname);

function walkSrc(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkSrc(full));
    } else if (
      // Production source only. Test files and Stories are excluded —
      // noting literal `useContext(` in a test description should not
      // trigger the rule; the rule applies to lib consumers, not to
      // tests of the lib.
      TS_SOURCE_FILE_NAME.test(entry.name) &&
      !TEST_FILE_NAME.test(entry.name) &&
      !STORIES_FILE_NAME.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Strip `// ...` line-tails and JSDoc `*`-prefixes so a regex hits code only. */
const TRAILING_LINE_COMMENT = /\/\/.*$/;
const LEADING_JSDOC_ASTERISK = /^\s*\*(?!\/)/;
// Production source only. Test files and Stories are excluded from the
// scan so JSDoc/test-description prose doesn't trip the rule.
const TEST_FILE_NAME = /\.test\.(ts|tsx)$/;
const STORIES_FILE_NAME = /\.stories\.(ts|tsx)$/;
const TS_SOURCE_FILE_NAME = /\.(ts|tsx)$/;
const USECONTEXT_CALL = /\buseContext\s*\(/;
const FORWARDREF_CALL = /(?:\bforwardRef\s*\(|React\.forwardRef\s*\()/;

/** Strip `// ...` line-tails and JSDoc `*`-prefixes so a regex hits code only. */
function stripCommentsLine(line: string): string {
  // JSDoc lines start with whitespace + `*`; ordinary single-line comments
  // begin with `//`. Both are documentation, not code; the regex should not
  // see their tokens.
  return line
    .replace(TRAILING_LINE_COMMENT, "")
    .replace(LEADING_JSDOC_ASTERISK, "");
}

/**
 * Scan every production source file under `packages/ui/src` for
 * code-line matches of the given regex. Comments are stripped first
 * so doc-prose mentions of the same identifier don't trip the test.
 */
function findCodeMatches(regex: RegExp): string[] {
  const matches: string[] = [];
  for (const file of walkSrc(UI_SRC)) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (const [index, raw] of lines.entries()) {
      const code = stripCommentsLine(raw);
      if (regex.test(code)) {
        matches.push(`${file}:${index + 1}: ${raw.trim()}`);
      }
    }
  }
  return matches;
}

describe("rule-8 (react19-no-forwardref) — use() instead of useContext()", () => {
  test("no `useContext(` callsites remain in @manobu/ui/src", () => {
    // The migration to `use()` removed every substitute for
    // `useContext()`. If this fails, either someone reintroduced
    // `useContext()` or a comment-cleaning rule needs an update.
    const hits = findCodeMatches(USECONTEXT_CALL);
    expect(hits).toEqual([]);
  });

  test("no `forwardRef(` callsites remain in @manobu/ui/src", () => {
    // React 19 dropped forwardRef's necessity. Any forwardRef call
    // here is a strong sign of "old pattern leaking through".
    const hits = findCodeMatches(FORWARDREF_CALL);
    expect(hits).toEqual([]);
  });

  test("useToolRenderers() reads through React 19's use() — overrides via <ToolRendererProvider>", () => {
    // Behavioural: a custom registry passed to <ToolRendererProvider>
    // must reach the consumer via `use(RendererContext)` — proves
    // the rule-8 migration isn't just "absence of useContext" but
    // a working `use()` read.
    function Key() {
      const reg = useToolRenderers();
      return (
        <span data-slot="renderer-keys">
          {Object.keys(reg).sort().join(",")}
        </span>
      );
    }
    const customRegistry = { lookup_vocab: () => null };
    const wrapped = renderToStaticMarkup(
      <ToolRendererProvider value={customRegistry}>
        <Key />
      </ToolRendererProvider>
    );
    expect(wrapped).toBe('<span data-slot="renderer-keys">lookup_vocab</span>');
  });

  test("useToolRenderers() falls back to the default registry outside any provider", () => {
    // Same hook, no Provider — returns the default `jlptToolRenderers`.
    // Confirms `use(RendererContext)` reads the surrounding context,
    // not a global singleton.
    function Key() {
      const reg = useToolRenderers();
      return (
        <span data-slot="renderer-keys">{Object.keys(reg).sort().length}</span>
      );
    }
    const bare = renderToStaticMarkup(createElement(Key));
    // 12 default renderers (conjugate_verb + 3 grammar + 3 kanji + 3 vocab + 2 pitch).
    expect(bare).toBe('<span data-slot="renderer-keys">12</span>');
  });
});
