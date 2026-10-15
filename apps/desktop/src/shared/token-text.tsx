/*
 * TokenText — tappable Japanese text with the coverage-ladder popover
 * (TASK-72: extracted from the reading corner so roleplay clerk lines
 * get the same "tap any word for help" mechanic for free).
 *
 * segmentSentence() guarantees every character lands in a token (story
 * word → particle table → kana mora → bare kanji → punct), so tapping
 * anything always answers at least a reading. Pass `words` (hand-authored
 * dictionary entries) for full coverage; without them the ladder still
 * covers everything via particles/kana/kanji.
 *
 * Hover previews romaji (CSS-only, keyboard parity via focus-within);
 * click opens a viewport-clamped popover with Esc + outside-pointer
 * dismiss. Save/speak/link capability is the caller's: pass onSave (and
 * isSaved) and the popover gates by token source (tokenCapabilities).
 */

import type { JlptLevel } from "@manobu/api-contract";
import { cn } from "@manobu/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Sentence, Token, Word } from "@/lib/reader-stories";
import { segmentSentence } from "@/lib/reader-stories";
import { ListenButton } from "@/shared/listen-button";

/* Which actions a token supports, by source: story + particle are full
 * dictionary entries (speak); kana morae speak only; bare kanji link
 * out to the detail page. Pure + exported for tests. */
export const tokenCapabilities = (
  token: Token
): { linkable: boolean; savable: boolean; speakable: boolean } => ({
  linkable: token.source === "kanji" || token.source === "story",
  savable: token.source === "story" || token.source === "particle",
  speakable: token.source !== "punct" && token.source !== "kanji",
});

/** The popover's meta line — every field the token can answer with. */
const tokenMeta = (token: Token): string =>
  [
    token.reading,
    token.gloss,
    token.romaji,
    token.level,
    token.source === "kanji" ? "no entry yet: see the kanji page" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

interface PopoverAnchor {
  bottom: number;
  left: number;
  token: Token;
  width: number;
}

const POPOVER_W = 256;

/** Center the popover on its anchor, clamped to the viewport so
 * line-edge words never overflow. */
const popoverLeft = (anchor: PopoverAnchor): number =>
  Math.min(
    Math.max(8, anchor.left + anchor.width / 2 - POPOVER_W / 2),
    window.innerWidth - POPOVER_W - 8
  );

const Popover = ({
  anchor,
  isSaved,
  onClose,
  onSave,
  popoverTestId,
  saveTestId,
}: {
  anchor: PopoverAnchor;
  isSaved?: (token: Token) => boolean;
  onClose: () => void;
  onSave?: (token: Token) => void;
  popoverTestId: string;
  saveTestId: string;
}) => {
  const ref = useRef<null | HTMLDivElement>(null);
  // Esc + outside-pointer dismiss (the old drawer's contract).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);
  const { token } = anchor;
  const { linkable, savable, speakable } = tokenCapabilities(token);
  const saved = isSaved?.(token) ?? false;
  const stableSave = useCallback(() => {
    onSave?.(token);
  }, [onSave, token]);
  return (
    <div
      className="fixed z-50 rounded-card border border-border bg-card p-3 text-left shadow-lg"
      data-testid={popoverTestId}
      ref={ref}
      role="dialog"
      style={{
        left: popoverLeft(anchor),
        top: anchor.bottom + 6,
        width: POPOVER_W,
      }}
    >
      <p className="text-lg">{token.text}</p>
      <p className="text-muted-foreground text-xs">{tokenMeta(token)}</p>
      <div className="mt-2 flex items-center gap-2">
        {speakable ? <ListenButton text={token.reading ?? token.text} /> : null}
        {savable && onSave ? (
          <button
            className={
              saved
                ? "text-muted-foreground text-sm"
                : "text-sm underline underline-offset-4 transition-colors hover:text-foreground"
            }
            data-testid={saveTestId}
            disabled={saved}
            onClick={stableSave}
            type="button"
          >
            {saved ? "saved ✓" : "save"}
          </button>
        ) : null}
        {linkable ? (
          <Link
            className="text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
            params={{ character: token.text }}
            to="/kanji/$character"
          >
            full entry →
          </Link>
        ) : null}
      </div>
    </div>
  );
};

/* One tappable token: the button, its hover romaji chip, and (when
 * open) the popover. Handlers are stable useCallbacks so props stay
 * referential (Ultracite noJsxPropsBind).
 *
 * `ink` mode (the reader page): tokens render as plain text. The accent
 * + underline appear on hover/focus (the affordance is asked for, same
 * contract as the gloss line) or from state: the token whose popover is
 * open, and saved tokens (your activity is the only color). The first
 * token of a page seeds the affordance for touch users who never
 * hover. Roleplay clerk lines keep the always-colored style: they are
 * short, and there the blue is the "tap to understand" invitation. */
const TokenChip = ({
  anchor,
  furigana,
  ink,
  isSaved,
  onClose,
  onOpen,
  onSave,
  popoverTestId,
  saveTestId,
  seeded,
  tapTestId,
  token,
}: {
  anchor: null | PopoverAnchor;
  furigana: boolean;
  ink?: boolean;
  isSaved?: (token: Token) => boolean;
  onClose: () => void;
  onOpen: (token: Token, el: HTMLButtonElement) => void;
  onSave?: (token: Token) => void;
  popoverTestId: string;
  saveTestId: string;
  /** Ink mode: render colored despite `ink` (the touch-affordance seed). */
  seeded?: boolean;
  tapTestId: string;
  token: Token;
}) => {
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      onOpen(token, e.currentTarget);
    },
    [onOpen, token]
  );
  const open = anchor?.token.key === token.key;
  /* Color carries state, not decoration: in ink mode the accent marks
   * the live interaction (open popover) and the touch seed; a SAVED
   * word gets a 朱 dot above-right — the stamp of "this one is yours"
   * — instead of colored text, so the paragraph stays ink. */
  const colored = !ink || open || seeded;
  const saved = isSaved?.(token) ?? false;
  return (
    <span className="group relative inline-block">
      <button
        aria-label={`Open dictionary for ${token.text}`}
        className={cn(
          "underline-offset-4 transition-colors",
          colored
            ? "text-primary underline decoration-primary/40 hover:decoration-primary"
            : "hover:text-primary hover:underline hover:decoration-primary/40 focus-visible:text-primary focus-visible:underline focus-visible:decoration-primary/40"
        )}
        data-jp={token.text}
        data-source={token.source}
        data-testid={tapTestId}
        onClick={onClick}
        type="button"
      >
        {furigana && token.reading ? (
          <ruby>
            {token.text}
            <rt>{token.reading}</rt>
          </ruby>
        ) : (
          token.text
        )}
      </button>
      {/* 朱 stamp: a saved word gets a small seal dot above-right, not
       * colored text — the paragraph stays ink, your work is marked. */}
      {ink && saved ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-0.5 right-0 size-1.5 rounded-full bg-mark"
          data-testid="token-stamp"
        />
      ) : null}
      {token.romaji || token.reading ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[10px] text-background opacity-0 transition-opacity delay-300 duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {token.romaji ?? token.reading}
        </span>
      ) : null}
      {open && anchor ? (
        <Popover
          anchor={anchor}
          isSaved={isSaved}
          onClose={onClose}
          onSave={onSave}
          popoverTestId={popoverTestId}
          saveTestId={saveTestId}
        />
      ) : null}
    </span>
  );
};

export interface TokenTextProps {
  /** Show <ruby> where a token's reading differs from its face. */
  furigana?: boolean;
  /** Reader mode: plain ink until hover/focus/open/saved (see TokenChip). */
  ink?: boolean;
  isSaved?: (token: Token) => boolean;
  /** Level stamped on the (synthetic) sentence for the ladder. */
  level?: JlptLevel;
  onSave?: (token: Token) => void;
  /** Fires for every non-punct token tap (the reader counts these). */
  onTap?: (token: Token) => void;
  /** Override for the popover container testid (reader keeps `reader-*`). */
  popoverTestId?: string;
  /** Override for the popover save-button testid. */
  saveTestId?: string;
  /** Ink mode: color the first token so touch users see the affordance. */
  seedFirst?: boolean;
  /** Override for the per-token button testid. */
  tapTestId?: string;
  /** The Japanese text — segmented with the coverage ladder. */
  text: string;
  /** Hand-authored dictionary entries for full coverage. */
  words?: Word[];
}

export const TokenText = ({
  furigana = false,
  ink = false,
  isSaved,
  level = "N5",
  onTap,
  onSave,
  popoverTestId = "token-popover",
  saveTestId = "token-popover-save",
  tapTestId = "token-tap",
  seedFirst = false,
  text,
  words = [],
}: TokenTextProps) => {
  const [anchor, setAnchor] = useState<null | PopoverAnchor>(null);
  const sentence: Sentence = useMemo(
    () => ({ en: "", jp: text, level, words }),
    [text, level, words]
  );
  const tokens = useMemo(() => segmentSentence(sentence), [sentence]);
  const onOpen = useCallback(
    (token: Token, el: HTMLButtonElement) => {
      onTap?.(token);
      setAnchor((prev) => {
        // Same token again = toggle closed (the outside-click listener
        // would otherwise reopen it on the same gesture).
        if (prev?.token.key === token.key) {
          return null;
        }
        const rect = el.getBoundingClientRect();
        return {
          bottom: rect.bottom,
          left: rect.left,
          token,
          width: rect.width,
        };
      });
    },
    [onTap]
  );
  const close = useCallback(() => {
    setAnchor(null);
  }, []);
  // Ink mode seeds the first token of each line colored: a touch learner
  // who never hovers still sees a blue underlined word and learns the
  // page is tappable. State (open/saved) is the other source of color.
  const firstKey = tokens.find((t) => t.source !== "punct")?.key;
  return (
    <>
      {tokens.map((token) =>
        token.source === "punct" ? (
          <span key={token.key}>{token.text}</span>
        ) : (
          <TokenChip
            anchor={anchor}
            furigana={furigana}
            ink={ink}
            isSaved={isSaved}
            key={token.key}
            onClose={close}
            onOpen={onOpen}
            onSave={onSave}
            popoverTestId={popoverTestId}
            saveTestId={saveTestId}
            seeded={seedFirst && token.key === firstKey}
            tapTestId={tapTestId}
            token={token}
          />
        )
      )}
    </>
  );
};
