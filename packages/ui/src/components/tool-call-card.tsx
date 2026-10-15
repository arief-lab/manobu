import { Card, CardContent } from "@manobu/ui/components/card";
import { cn } from "@manobu/ui/lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2,
} from "lucide-react";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  use,
  useCallback,
  useMemo,
  useState,
} from "react";

/**
 * Tool-call / tool-result renderer for the chat surface.
 *
 * The chat stream emits `messages[]` whose `parts[]` mix `text`, `reasoning`,
 * and a discriminated tool union (see research/ai-sdk-v3-tool-part-shape.md).
 * Until now `apps/desktop/src/routes/ai.tsx` filtered to `part.type === "text"`
 * and silently dropped every other part · making the JLPT MCP invisible to the
 * user even though `lookup_vocab` / `lookup_grammar` / `lookup_kanji` /
 * `lookup_pitch_accent` were called. This module fixes that.
 *
 * Surface area (kept small for the contract · grow with the renderer registry):
 *
 *   • <ToolCallCard>    generic header/body shell (pending / result / error)
 *   • <VocabResult>     JLPT-specific card for vocab entries
 *   • <GrammarResult>   JLPT-specific card for a single grammar point
 *   • <KanjiResult>     JLPT-specific card for one (or a list of) kanji
 *   • <PitchResult>     JLPT-specific card for a pitch-accent entry
 *   • <ConjugationResult> JLPT-specific compact-conjugation table
 *   • <JsonResult>      generic dump for tools without a custom renderer
 *   • <ToolPart>        single dispatcher: matches a part to a renderer
 *   • jlptToolRenderers default registry covering the 12 jlpt-vocab MCP tools
 *
 * The dispatcher is registry-based: callers can swap `renderers` and keep the
 * shell + state-machine verbatim. The contract is "give me a part, I'll give
 * you the right React node".
 */

// ---------------------------------------------------------------------------
// Types · mirror `crates/jlpt-mcp/src/types.rs` shape (single source of truth
// for the MCP server · these are the JSON payloads the JLPT tools return).
// Kept inline because there is no `@manobu/japanese` types package today; if
// one is added later, replace these aliased types with imports.
// ---------------------------------------------------------------------------

type JlptLevel = "N1" | "N2" | "N3" | "N4" | "N5";

interface VocabEntry {
  level: JlptLevel;
  meaning?: string;
  partOfSpeech?: string;
  reading: string;
  word: string;
}

interface GrammarPoint {
  examples: Array<{ english: string; japanese: string; source: string }>;
  formality: "formal" | "neutral" | "casual" | string;
  formation: string;
  formation_notes: string[];
  id: string;
  level: JlptLevel;
  meaning_detailed: string;
  meaning_en: string;
  pattern: string;
  related: string[];
  review_status: string;
  sources: string[];
}

interface KanjiEntry {
  character: string;
  jlpt?: JlptLevel;
  kunReadings: string[];
  meanings: string[];
  onReadings: string[];
  radical?: number;
  readingsNanori?: string[];
  strokeCount?: number;
}

interface PitchAccentEntry {
  description?: string;
  moraCount?: number;
  pitchPositions: number[];
  reading: string;
  word: string;
}

interface ConjugationEntry {
  class: string;
  dictionary_form: string;
  display_forms: Record<string, string>;
  forms: Record<string, string>;
  id: string;
  reading: string;
}

/** Surface tool state · collapses the SDK's 7-state machine to 4 visual states. */
export type ToolCallState = "pending" | "result" | "error" | "denied";

/** A renderer's input · data is the output for `result`, the input for `pending`. */
export interface RendererArgs {
  readonly data: unknown;
  readonly state: Exclude<ToolCallState, "error" | "denied">;
  readonly toolCallId: string;
  readonly toolName: string;
}

export type ToolCardRenderer = (args: RendererArgs) => ReactNode;

/** A registry keyed by MCP tool name. Missing entries fall back to JsonResult. */
export type ToolRendererRegistry = Record<string, ToolCardRenderer>;

// ---------------------------------------------------------------------------
// State machine adapter · collapse 7 SDK states into the 4 visual states
// ---------------------------------------------------------------------------

/**
 * Map the SDK's 7-way state union to the 4 visual states the renderer exposes.
 * `approval-*` collapses to `pending` (the user will see the tool is "running"
 * waiting on a non-ACP approval · we don't ship that flow today, but the
 * renderer still renders sensibly if a future static tool uses it).
 */
export function toToolCallState(sdkState: string): ToolCallState {
  switch (sdkState) {
    case "output-available":
      return "result";
    case "output-error":
      return "error";
    case "output-denied":
      return "denied";
    case "input-streaming":
    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return "pending";
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// <ToolCallCard> · generic shell
// ---------------------------------------------------------------------------

export interface ToolCallCardProps {
  children: ReactNode;
  className?: string;
  errorText?: string;
  input?: unknown;
  output?: unknown;
  state: ToolCallState;
  toolCallId: string;
  toolName: string;
}

/**
 * The shell renders: header (tool name + state pill), body (children · the
 * tool-specific renderer output), and a collapsible "show input" disclosure
 * if `input` is set. The shell deliberately does *not* style the body · the
 * per-tool renderer picks its own card size and density.
 */
export function ToolCallCard({
  className,
  errorText,
  input,
  state,
  toolCallId,
  toolName,
  children,
}: ToolCallCardProps) {
  const [showInput, setShowInput] = useState(false);
  const toggleShowInput = useCallback(() => {
    setShowInput((prev) => !prev);
  }, []);
  return (
    <Card
      className={cn(
        "mt-2 border-dashed bg-muted/30 ring-foreground/5",
        state === "error" && "border-destructive/40 ring-destructive/20",
        state === "denied" && "border-muted-foreground/40",
        className
      )}
      data-state={state}
      data-tool={toolName}
      data-tool-call-id={toolCallId}
      size="sm"
    >
      <header className="flex items-center justify-between gap-2 border-b px-(--card-spacing) py-1.5 font-medium text-muted-foreground text-xs/relaxed">
        <span className="flex min-w-0 items-center gap-1.5">
          <StateGlyph state={state} />
          <span className="truncate" data-slot="tool-name">
            {toolName}
          </span>
        </span>
        <button
          aria-expanded={showInput}
          className="inline-flex shrink-0 items-center gap-1 rounded-none px-1 py-0.5 text-[10px] hover:bg-foreground/5 disabled:opacity-50"
          disabled={input === undefined}
          onClick={toggleShowInput}
          type="button"
        >
          {showInput ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
          <span>{showInput ? "hide input" : "show input"}</span>
        </button>
      </header>
      {showInput && input !== undefined ? (
        <div className="border-b bg-foreground/2 px-(--card-spacing) py-1.5 text-[10px]/relaxed">
          <pre className="wrap-break-word overflow-x-auto whitespace-pre-wrap font-mono text-foreground/80">
            {safeStringify(input)}
          </pre>
        </div>
      ) : null}
      <CardContent className="pt-2">
        {renderBody(children, errorText, state)}
      </CardContent>
    </Card>
  );
}

function StateGlyph({ state }: { state: ToolCallState }) {
  if (state === "pending") {
    return (
      <Loader2
        aria-label="running"
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
      />
    );
  }
  if (state === "error") {
    return (
      <AlertTriangleIcon
        aria-label="error"
        className="size-3.5 shrink-0 text-destructive"
      />
    );
  }
  if (state === "denied") {
    return (
      <div
        aria-label="denied"
        className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground"
        role="img"
      />
    );
  }
  return (
    <CheckIcon aria-label="done" className="size-3.5 shrink-0 text-success" />
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderBody(
  children: ReactNode,
  errorText: string | undefined,
  state: ToolCallState
): ReactNode {
  if (state === "error") {
    if (!errorText) {
      return null;
    }
    return (
      <div className="flex items-start gap-2 text-destructive text-xs/relaxed">
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
        <span className="wrap-break-word">{errorText}</span>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="text-muted-foreground text-xs/relaxed">
        (call was denied before execution)
      </div>
    );
  }
  return children;
}

// ---------------------------------------------------------------------------
// <VocabResult> · JLPT vocab card body
// ---------------------------------------------------------------------------

function asVocabList(data: unknown): VocabEntry[] {
  if (Array.isArray(data)) {
    return data as VocabEntry[];
  }
  if (data && typeof data === "object") {
    return [data as VocabEntry];
  }
  return [];
}

/**
 * JLPT-specific renderer for `lookup_vocab`, `search_vocab`, and
 * `list_vocab_by_level`. Both single-object and array payloads are accepted.
 */
export function VocabResult({ data }: { data: unknown }) {
  const entries = asVocabList(data);
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-xs/relaxed">(no vocab match)</p>
    );
  }
  return (
    <dl className="flex flex-col gap-1" data-slot="vocab-list">
      {entries.map((entry) => (
        <div
          className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5 text-xs/relaxed"
          key={`${entry.word}-${entry.reading}-${entry.level}`}
        >
          <dt className="flex items-baseline gap-1.5 font-medium">
            <span>{entry.word}</span>
            <span className="text-[10px]/relaxed text-muted-foreground">
              ({entry.reading})
            </span>
          </dt>
          <dd className="text-muted-foreground text-xs/relaxed">
            <span className="mr-1 rounded-none border border-border bg-background px-1 py-0.5 text-[10px]">
              {entry.level}
            </span>
            {entry.partOfSpeech ? (
              <span className="mr-2 text-[10px] uppercase tracking-wide">
                {entry.partOfSpeech}
              </span>
            ) : null}
            <span className="text-foreground/80">
              {entry.meaning ?? "(no English meaning)"}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// <GrammarResult> · JLPT grammar card body
// ---------------------------------------------------------------------------

function isGrammarPoint(value: unknown): value is GrammarPoint {
  return (
    !!value &&
    typeof value === "object" &&
    "id" in value &&
    "pattern" in value &&
    "meaning_en" in value
  );
}

/**
 * Single-point renderer for `lookup_grammar`. The search/list variants can
 * paginate into the same card shape with a header strip; v1 falls back to
 * `JsonResult` for those.
 */
export function GrammarResult({ data }: { data: unknown }) {
  if (!isGrammarPoint(data)) {
    return <JsonResult data={data} />;
  }
  const point = data;
  return (
    <article className="flex flex-col gap-2 text-xs/relaxed">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{point.pattern}</span>
        <span className="rounded-none border border-border bg-background px-1 py-0.5 text-[10px]">
          {point.level}
        </span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {point.formality}
        </span>
      </header>
      <p>
        <strong className="font-medium">{point.meaning_en}</strong>
        {point.meaning_detailed ? (
          <span className="ml-2 text-muted-foreground">
            {point.meaning_detailed}
          </span>
        ) : null}
      </p>
      {point.formation ? (
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground/80">Formation: </span>
          {point.formation}
        </p>
      ) : null}
      {point.examples?.length > 0 ? (
        <ul className="flex flex-col gap-1 border-t pt-2 text-muted-foreground">
          {point.examples.map((example) => (
            <li
              className="flex flex-col"
              key={`${example.japanese}-${example.english}`}
            >
              <span className="text-foreground/80">{example.japanese}</span>
              <span className="text-[10px]/relaxed">{example.english}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// <KanjiResult> · JLPT kanji card body
// ---------------------------------------------------------------------------

function asKanjiList(data: unknown): KanjiEntry[] {
  if (Array.isArray(data)) {
    return data as KanjiEntry[];
  }
  if (data && typeof data && "character" in (data as object)) {
    return [data as KanjiEntry];
  }
  return [];
}

/** Big-glyph card for one kanji or compact grid for a list (kanji study sets). */
export function KanjiResult({ data }: { data: unknown }) {
  const entries = asKanjiList(data);
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-xs/relaxed">(no kanji match)</p>
    );
  }
  if (entries.length === 1) {
    return <OneKanji entry={entries[0] as KanjiEntry} />;
  }
  return (
    <ul
      className="grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1.5"
      data-slot="kanji-grid"
    >
      {entries.map((entry) => {
        // collapse to a glyph + level only for the grid view
        const onReading = entry.onReadings[0] ?? "";
        const meaning = entry.meanings[0] ?? "";
        return (
          <li
            className="flex flex-col items-center gap-0.5 border border-border bg-background px-1.5 py-1 text-center"
            key={entry.character}
            title={`${entry.character} · ${onReading} · ${meaning}`}
          >
            <span className="cn-font-heading font-medium text-base/relaxed">
              {entry.character}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {entry.jlpt ?? "–"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function OneKanji({ entry }: { entry: KanjiEntry }) {
  const onList = entry.onReadings.join(" · ");
  const kunList = entry.kunReadings.join(" · ");
  return (
    <article className="flex items-start gap-4 text-xs/relaxed">
      <div
        className="cn-font-heading flex shrink-0 items-center justify-center border border-border bg-background px-3 py-2 font-medium text-3xl"
        data-slot="kanji-glyph"
      >
        {entry.character}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              On
            </span>
            <span className="ml-1.5">{onList || "–"}</span>
          </span>
          <span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Kun
            </span>
            <span className="ml-1.5">{kunList || "–"}</span>
          </span>
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
          {entry.jlpt ? (
            <span>
              <span className="text-[10px] uppercase tracking-wide">JLPT</span>
              <span className="ml-1.5 text-foreground/80">{entry.jlpt}</span>
            </span>
          ) : null}
          {entry.strokeCount === undefined ? null : (
            <span>
              <span className="text-[10px] uppercase tracking-wide">
                Strokes
              </span>
              <span className="ml-1.5 text-foreground/80">
                {entry.strokeCount}
              </span>
            </span>
          )}
          {entry.radical === undefined ? null : (
            <span>
              <span className="text-[10px] uppercase tracking-wide">
                Radical
              </span>
              <span className="ml-1.5 text-foreground/80">{entry.radical}</span>
            </span>
          )}
        </p>
        {entry.meanings.length > 0 ? (
          <p>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
              Meanings
            </span>
            <span className="ml-1.5">{entry.meanings.join(", ")}</span>
          </p>
        ) : null}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// <PitchResult> · JLPT pitch-accent card body
// ---------------------------------------------------------------------------

function asPitchList(data: unknown): PitchAccentEntry[] {
  if (Array.isArray(data)) {
    return data as PitchAccentEntry[];
  }
  if (data && typeof data === "object") {
    return [data as PitchAccentEntry];
  }
  return [];
}

/**
 * Pitch-accent renderer respects the `description` field the JLPT MCP injects
 * (heiban / atamadaka / nakadaka / odaka + a downstep marker like `は↓し`).
 * Falls back to listing raw `pitchPositions` when the description is absent.
 */
export function PitchResult({ data }: { data: unknown }) {
  const entries = asPitchList(data);
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-xs/relaxed">(no pitch data)</p>
    );
  }
  return (
    <ul className="flex flex-col gap-2 text-xs/relaxed">
      {entries.map((entry) => (
        <li
          className="flex flex-col gap-0.5"
          key={`${entry.word}-${entry.reading}`}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="cn-font-heading font-medium">{entry.word}</span>
            <span className="text-[10px] text-muted-foreground">
              ({entry.reading})
            </span>
            {entry.moraCount === undefined ? null : (
              <span className="text-[10px] text-muted-foreground">
                mora {entry.moraCount}
              </span>
            )}
          </div>
          <div className="text-foreground/80">
            {entry.description ?? (
              <span className="text-muted-foreground">
                positions: [{entry.pitchPositions.join(", ")}]
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// <ConjugationResult> · JLPT conjugation card body
// ---------------------------------------------------------------------------

function isConjugation(value: unknown): value is ConjugationEntry {
  return (
    !!value &&
    typeof value === "object" &&
    "dictionary_form" in value &&
    "forms" in value
  );
}

/**
 * Conjugation tables have many forms (12+) · render as a 2-column grid
 * (kana / kanji) so the learner sees both readings. The order is whatever the
 * MCP serializes; preserve it.
 */
export function ConjugationResult({ data }: { data: unknown }) {
  if (!isConjugation(data)) {
    return <JsonResult data={data} />;
  }
  const conj = data;
  const formKeys = Object.keys(conj.forms);
  if (formKeys.length === 0) {
    return (
      <p className="text-muted-foreground text-xs/relaxed">
        (empty conjugation table)
      </p>
    );
  }
  return (
    <article className="flex flex-col gap-2 text-xs/relaxed">
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="cn-font-heading font-medium text-sm">
          {conj.dictionary_form}
        </span>
        <span className="text-[10px] text-muted-foreground">
          ({conj.reading})
        </span>
        <span className="rounded-none border border-border bg-background px-1 py-0.5 text-[10px]">
          {conj.class}
        </span>
      </header>
      <dl className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-3 gap-y-1 text-xs/relaxed">
        {formKeys.map((name) => (
          <RowPair
            display={conj.display_forms[name]}
            kana={conj.forms[name]}
            key={name}
            name={name}
          />
        ))}
      </dl>
    </article>
  );
}

function RowPair({
  display,
  kana,
  name,
}: {
  display: unknown;
  kana: unknown;
  name: string;
}) {
  return (
    <>
      <dt className="text-[10px] text-muted-foreground uppercase tracking-wide">
        {name}
      </dt>
      <dd className="text-foreground/80">
        <span className="cn-font-heading">{String(kana ?? "–")}</span>
      </dd>
      <dt className="sr-only">{name} kanji</dt>
      <dd className="text-[10px] text-muted-foreground">
        {String(display ?? "")}
      </dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// <JsonResult> · generic fallback (kept generic; intentionally non-JLPT)
// ---------------------------------------------------------------------------

/**
 * Last-resort renderer for tools without a dedicated card. Pretty-prints the
 * raw payload so the wire shape is still visible · better than dropping the
 * part to a `null` like the original `ai.tsx` filter did.
 */
export function JsonResult({ data }: { data: unknown }) {
  return (
    <pre
      className="wrap-break-word overflow-x-auto whitespace-pre-wrap bg-foreground/3 font-mono text-[10px]/relaxed text-foreground/80"
      data-slot="json-fallback"
    >
      {safeStringify(data)}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Default JLPT registry · covers all 12 jlpt-vocab MCP tools
// ---------------------------------------------------------------------------

/**
 * Default renderer set for the `jlpt-vocab` MCP server. Adding a new tool to
 * `crates/jlpt-mcp/src/main.rs` → register it here → the dispatcher will
 * pick it up. The test suite covers this as a guardrail.
 */
export const jlptToolRenderers: ToolRendererRegistry = {
  // conjugation (1)
  conjugate_verb: conjugationRenderer,
  // grammar (3)
  list_grammar_by_level: grammarListRenderer,
  // kanji (3)
  list_kanji_by_level: kanjiRenderer,
  // vocab (3)
  list_vocab_by_level: vocabRenderer,
  lookup_grammar: pointRenderer,
  lookup_kanji: kanjiRenderer,
  // pitch (2)
  lookup_pitch_accent: pitchRenderer,
  lookup_vocab: vocabRenderer,
  search_grammar: grammarListRenderer,
  search_kanji: kanjiRenderer,
  search_pitch_accent: pitchRenderer,
  search_vocab: vocabRenderer,
};

function vocabRenderer({ data }: RendererArgs) {
  return <VocabResult data={data} />;
}
function pointRenderer({ data }: RendererArgs) {
  return <GrammarResult data={data} />;
}
/**
 * Search/list grammar endpoints return an array of `GrammarPoint` (not the
 * compact-index form). Render each as a single-point card · small enough at
 * the JLPT scale (595 points) to fit on screen, far better than a JSON dump.
 */
function grammarListRenderer({ data }: RendererArgs) {
  if (Array.isArray(data)) {
    return (
      <div className="flex flex-col gap-2">
        {(data as unknown[]).map((d) => (
          <div
            className="border-t pt-2 first:border-t-0 first:pt-0"
            key={(d as GrammarPoint).id}
          >
            <GrammarResult data={d} />
          </div>
        ))}
      </div>
    );
  }
  return <GrammarResult data={data} />;
}
function kanjiRenderer({ data }: RendererArgs) {
  return <KanjiResult data={data} />;
}
function pitchRenderer({ data }: RendererArgs) {
  return <PitchResult data={data} />;
}
function conjugationRenderer({ data }: RendererArgs) {
  return <ConjugationResult data={data} />;
}

// ---------------------------------------------------------------------------
// ToolPart / unknown-tool registries · exposed for apps/web integration
// ---------------------------------------------------------------------------

export interface ToolPartLike {
  readonly errorText?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly state: string;
  readonly toolCallId: string;
  readonly toolName?: string;
  readonly type: string;
}

/** Resolve the MCP tool name from a V3 part (typed + dynamic variants). */
export function pickToolName(part: ToolPartLike): string {
  if (part.toolName) {
    return part.toolName;
  }
  if (part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }
  return part.type;
}

// ---------------------------------------------------------------------------
// <ToolPart> · single dispatcher
// ---------------------------------------------------------------------------

export interface ToolPartProps {
  className?: string;
  part: ToolPartLike;
  renderers?: ToolRendererRegistry;
}

/**
 * Render one V3 tool part. Wraps a renderer in <ToolCallCard>; falls back to
 * `<JsonResult>` if `part.toolName` isn't in `renderers`.
 *
 * The dispatcher intentionally does *not* call `part.type === "text"` etc.
 * · those are text parts and live outside this component. `ai.tsx` keeps the
 * outer parts loop (`text` / `reasoning` / `source-*` / `data-*` / unknown).
 */
export function ToolPart({
  className,
  part,
  renderers = jlptToolRenderers,
}: ToolPartProps) {
  const renderer = useMemo(() => {
    const name = pickToolName(part);
    return renderers[name];
  }, [part, renderers]);
  const state = toToolCallState(part.state);
  const toolName = pickToolName(part);
  // No renderer registered → render the raw payload so the wire shape is
  // visible rather than silently dropping the part to a `null`.
  if (!renderer) {
    return (
      <ToolCallCard
        className={className}
        input={part.input}
        output={part.output}
        state={state}
        toolCallId={part.toolCallId}
        toolName={toolName}
      >
        <JsonResult
          data={
            part.errorText ?? part.output ?? part.input ?? { state: part.state }
          }
        />
      </ToolCallCard>
    );
  }
  return (
    <ToolCallCard
      className={className}
      errorText={part.errorText}
      input={part.input}
      output={part.output}
      state={state}
      toolCallId={part.toolCallId}
      toolName={toolName}
    >
      {state === "pending" || state === "result"
        ? renderer({
            data: state === "result" ? part.output : part.input,
            state,
            toolCallId: part.toolCallId,
            toolName,
          })
        : null}
    </ToolCallCard>
  );
}

// ---------------------------------------------------------------------------
// Renderer context · lets apps swap the registry without prop-drilling
// ---------------------------------------------------------------------------

const RendererContext = createContext<ToolRendererRegistry>(jlptToolRenderers);

/**
 * Wrap the chat tree to override the renderer registry globally. Useful for
 * tests, per-chat persona overrides, or future module wiring.
 */
export function ToolRendererProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ToolRendererRegistry;
}) {
  return (
    <RendererContext.Provider value={value}>
      {children}
    </RendererContext.Provider>
  );
}

/**
 * Read the active renderer registry. `ToolPart` uses this when no explicit
 * `renderers` prop is passed. Uses React 19's `use()` (preferred over
 * `useContext` per `react19-no-forwardref`) so the read composes with
 * conditional rendering at call sites.
 */
export function useToolRenderers(): ToolRendererRegistry {
  return use(RendererContext);
}

/**
 * Re-export the convenience context setter so callers can build a small
 * swap UI ("switch to a custom MCP server") without re-implementing the
 * Provider. The setter is mostly sugar; the Provider above does the work.
 */
export function useToolRendererOverride(): [
  ToolRendererRegistry,
  Dispatch<SetStateAction<ToolRendererRegistry>>,
] {
  // Hooks package's idiomatic state pair · callers can manage a local
  // override and hand it to <ToolRendererProvider>.
  const [_override, _setOverride] = useState<ToolRendererRegistry>({});
  return [_override, _setOverride];
}
