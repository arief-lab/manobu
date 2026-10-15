/*
 * Reading Corner (SCR-05 redesign) — the reader as sensei's reading page.
 *
 * Same object family as the worksheet: chrome-free, its own ← desk bar,
 * one thing per screen. The comprehension ladder carries over: the
 * Japanese is the face, the English is ASKED FOR (the dotted line under
 * a sentence reveals its gloss; the token popover reveals reading +
 * meaning). Reading the Japanese is the default path; the crutch is
 * never given, never banned.
 *
 * Full coverage (TASK-72 improve pass): segmentSentence() guarantees
 * EVERY character lands in a token (story word → particle table →
 * kana mora → bare kanji), so "tap anything, always get at least a
 * reading" holds. Hover (fine pointers only) previews romaji after a
 * beat; click/tap/Enter opens the full popover. Kanji tokens with no
 * dictionary entry link the kanji detail page instead of inventing a
 * reading. Ruby (real furigana) renders over a token when its reading
 * differs from its face, default ON at N5/N4 — the old compound only
 * ever printed a "Furigana: ON" status line.
 *
 * The token machinery (popover, hover chip, dismiss, capabilities) is
 * the shared <TokenText> from `@/shared/token-text` — extracted so the
 * roleplay clerk lines get identical coverage (TASK-73). This file owns
 * the story scope: touched/gloss/saved state, the bar, the close line,
 * the shelf.
 *
 * Composition (Vercel pattern):
 *   <ReadingCorner story>          provider: touched/gloss/saved state
 *     <ReadingCorner.Bar />        ← shelf · furigana · dots · [🔊 story]
 *     <ReadingCorner.Page />       sentences, inline tokens, per-line ▶
 *     <ReadingCorner.Close />      honest close once every sentence touched
 *   </ReadingCorner>
 *   <ReaderShelf />                the shelf (pure props, no provider)
 *
 * Data-honesty: dots fill when a sentence was TOUCHED (token tapped or
 * gloss revealed — engagement, not time); the close line counts real
 * taps and real saves; "due tomorrow" is the FSRS default. No quiz —
 * the worksheet owns recall, the reader owns encounter.
 */

import { saveFsrsToast } from "@manobu/ui/lib/toast";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import type {
  ReaderStory,
  Sentence,
  StoryKey,
  Token,
} from "@/lib/reader-stories";
import { iconForSentence, STORY_SHELF } from "@/lib/reader-stories";
import { ListenButton } from "@/shared/listen-button";
import { TokenText } from "@/shared/token-text";

/* ── scope ───────────────────────────────────────────────────── */

interface CornerContext {
  furigana: boolean;
  glossRevealed: (index: number) => boolean;
  isSaved: (token: Token) => boolean;
  onTokenTap: (index: number) => void;
  revealGloss: (index: number) => void;
  savedCount: number;
  saveToken: (token: Token) => void;
  sentenceDone: (index: number) => boolean;
  story: ReaderStory;
  tapCount: number;
  toggleFurigana: () => void;
}

const CornerScope = createContext<CornerContext | null>(null);

const useCorner = (): CornerContext => {
  const ctx = useContext(CornerScope);
  if (!ctx) {
    throw new Error("useCorner must be used within ReadingCorner");
  }
  return ctx;
};

interface ReadingCornerProps {
  children: ReactNode;
  story: ReaderStory;
}

const ReadingCorner = ({ children, story }: ReadingCornerProps) => {
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [glossed, setGlossed] = useState<Set<number>>(() => new Set());
  const [saved, setSaved] = useState<Set<string>>(() => new Set());
  const [tapCount, setTapCount] = useState(0);
  // Real ruby over kanji faces, default ON for the beginner levels —
  // the level rule the old compound only ever announced in text.
  const [furigana, setFurigana] = useState(
    () => story.level === "N5" || story.level === "N4"
  );

  const markTouched = useCallback((index: number) => {
    setTouched((prev) => {
      if (prev.has(index)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);
  const onTokenTap = useCallback(
    (sentenceIndex: number) => {
      setTapCount((t) => t + 1);
      markTouched(sentenceIndex);
    },
    [markTouched]
  );
  const revealGloss = useCallback(
    (index: number) => {
      setGlossed((prev) => {
        const next = new Set(prev);
        next.add(index);
        return next;
      });
      markTouched(index);
    },
    [markTouched]
  );
  const saveToken = useCallback((token: Token) => {
    setSaved((s) => (s.has(token.text) ? s : new Set(s).add(token.text)));
    saveFsrsToast({
      n: 1,
      onUndo: () => {
        setSaved((s) => {
          const next = new Set(s);
          next.delete(token.text);
          return next;
        });
      },
      retention: 0.9,
    }).catch(() => undefined);
  }, []);
  const toggleFurigana = useCallback(() => {
    setFurigana((v) => !v);
  }, []);

  const ctx: CornerContext = {
    furigana,
    glossRevealed: (index) => glossed.has(index),
    isSaved: (token) => saved.has(token.text),
    onTokenTap,
    revealGloss,
    savedCount: saved.size,
    saveToken,
    sentenceDone: (index) => touched.has(index),
    story,
    tapCount,
    toggleFurigana,
  };
  return (
    <CornerScope.Provider value={ctx}>
      <div
        className="mx-auto flex min-h-full w-full max-w-170 flex-col gap-4 p-4"
        data-testid="reading-corner"
      >
        {children}
      </div>
    </CornerScope.Provider>
  );
};

/* ── bar ───────────────────────────────────────────────────────── */

const Bar = () => {
  const { furigana, sentenceDone, story, tapCount, toggleFurigana } =
    useCorner();
  const fullText = useMemo(
    () => story.sentences.map((s) => s.jp).join(" "),
    [story.sentences]
  );
  return (
    <header className="flex items-center justify-between px-1">
      <Link
        className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        data-testid="reader-back-shelf"
        search={{}}
        to="/reader"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        shelf
      </Link>
      <p className="text-muted-foreground text-sm">
        {story.title} · {story.level}
        {tapCount > 0 ? ` · ${tapCount} taps` : ""}
      </p>
      {/* The wrapper is NOT aria-hidden: it contains real controls
       * (furigana toggle, listen). Only the decorative dots are. */}
      <span className="flex items-center gap-2">
        <button
          aria-pressed={furigana}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-2.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground data-[aria-pressed=true]:border-primary/60 data-[aria-pressed=true]:text-foreground"
          data-testid="reader-furigana-toggle"
          onClick={toggleFurigana}
          type="button"
        >
          ふりがな
        </button>
        <span aria-hidden className="flex gap-1.5">
          {story.sentences.map((s, i) => (
            <span
              className={
                sentenceDone(i)
                  ? "size-2.5 rounded-full bg-primary"
                  : "size-2.5 rounded-full border border-border"
              }
              key={s.jp}
            />
          ))}
        </span>
        <ListenButton text={fullText} />
      </span>
    </header>
  );
};

/* ── page ──────────────────────────────────────────────────────── */

const SentenceLine = ({
  index,
  sentence,
}: {
  index: number;
  sentence: Sentence;
}) => {
  const {
    furigana,
    glossRevealed,
    isSaved,
    onTokenTap,
    revealGloss,
    saveToken,
  } = useCorner();
  const revealed = glossRevealed(index);
  const onReveal = useCallback(() => {
    revealGloss(index);
  }, [index, revealGloss]);
  const onTap = useCallback(() => {
    onTokenTap(index);
  }, [index, onTokenTap]);
  return (
    <div className="flex flex-col gap-1" data-sentence={index}>
      <p className="text-xl leading-loose tracking-wide">
        <TokenText
          furigana={furigana}
          ink
          isSaved={isSaved}
          level={sentence.level}
          onSave={saveToken}
          onTap={onTap}
          popoverTestId="reader-popover"
          saveTestId="reader-popover-save"
          seedFirst={index === 0}
          tapTestId="reader-tap"
          text={sentence.jp}
          words={sentence.words}
        />
      </p>
      <div className="flex items-center gap-2">
        {/* The comprehension ladder: the dotted line IS "translate
         * this" — the English never shows unless asked for. The button
         * is a full 24px tall with the line drawn inside, so the hit
         * target is real (h-0.5 alone was a 2px target). */}
        <button
          aria-expanded={revealed}
          className="group/line flex h-6 min-w-24 flex-1 items-center"
          data-testid={`reader-gloss-${index}`}
          onClick={onReveal}
          type="button"
        >
          <span className="h-0 w-full border-border border-t border-dashed transition-colors group-hover/line:border-primary/60" />
        </button>
        <ListenButton text={sentence.jp} />
      </div>
      {revealed ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid={`reader-gloss-text-${index}`}
        >
          {sentence.en}
        </p>
      ) : null}
    </div>
  );
};

const Page = () => {
  const { story } = useCorner();
  return (
    <article
      aria-label={story.title}
      className="flex flex-1 flex-col gap-6 rounded-card border border-border bg-card p-8"
      data-testid="reader-story"
    >
      <p className="text-muted-foreground text-xs">
        tap any word for help · tap the line under a sentence for the
        translation
      </p>
      {story.sentences.map((sentence, i) => (
        <div className="flex items-start gap-3" key={sentence.jp}>
          <span aria-hidden className="shrink-0 pt-1 text-xl">
            {iconForSentence(story, i) ?? ""}
          </span>
          <div className="flex-1">
            <SentenceLine index={i} sentence={sentence} />
          </div>
        </div>
      ))}
    </article>
  );
};

/* ── close ────────────────────────────────────────────────────── */

const Close = () => {
  const { savedCount, sentenceDone, story, tapCount } = useCorner();
  const finished =
    story.sentences.length > 0 &&
    story.sentences.every((_s, i) => sentenceDone(i));
  if (!finished) {
    return null;
  }
  return (
    <section
      className="rounded-card border border-border bg-card p-6 text-center"
      data-testid="reader-close"
    >
      <p>
        finished {story.title} · {tapCount} {tapCount === 1 ? "tap" : "taps"} of
        help
        {savedCount > 0 ? ` · ${savedCount} saved` : ""}
      </p>
      <p className="mt-1 text-muted-foreground text-sm">
        {savedCount > 0
          ? "saved words are due tomorrow. The desk will say so"
          : "nothing saved. Tap a word and save it to start the queue"}
      </p>
    </section>
  );
};

/* ── shelf ─────────────────────────────────────────────────────── */

const ShelfCard = ({
  story,
  storyKey,
}: {
  story: ReaderStory;
  storyKey: StoryKey;
}) => (
  <Link
    className="flex flex-col gap-2 rounded-card border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/60"
    data-testid={`shelf-${storyKey}`}
    search={{ story: storyKey }}
    to="/reader"
  >
    <span aria-hidden className="text-2xl">
      {story.icon}
    </span>
    <span className="font-semibold text-lg">{story.title}</span>
    <span className="text-muted-foreground text-sm">{story.subtitle}</span>
    <span className="text-muted-foreground text-xs">
      {story.level} · {story.sentences.length} sentences · every word tapable
    </span>
  </Link>
);

export const ReaderShelf = () => (
  <div
    className="mx-auto flex min-h-full w-full max-w-170 flex-col gap-4 p-4"
    data-testid="reader-shelf"
  >
    <header className="flex items-center justify-between px-1">
      <Link
        className="flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
        data-testid="reader-back-desk"
        to="/dashboard"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        desk
      </Link>
      <p className="text-muted-foreground text-sm">Reader</p>
      <span aria-hidden className="w-12" />
    </header>
    <p className="px-1 text-muted-foreground text-sm">pick something to read</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {STORY_SHELF.map(({ key, story }) => (
        <ShelfCard key={key} story={story} storyKey={key} />
      ))}
    </div>
  </div>
);

export const ReadingCornerCompound = Object.assign(ReadingCorner, {
  Bar,
  Close,
  Page,
});
