import { autoDownload, detectPcSpec, knownModels } from "@manobu/speech/models";
import {
  ensurePlaybackAudioContext,
  playWavBytes,
  speak,
} from "@manobu/speech/tts";
import type { ModelInfo, SpeechStatus } from "@manobu/speech/types";
import { Button } from "@manobu/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@manobu/ui/components/card";
import { InputGroup } from "@manobu/ui/components/input-group";
import { createFileRoute } from "@tanstack/react-router";
import { MicIcon, VolumeIcon, ZapIcon } from "lucide-react";
import { type ChangeEvent, type ReactNode, useCallback, useState } from "react";
import {
  speechModelsQueryOptions,
  speechStatusQueryOptions,
  useSpeechModels,
  useSpeechStatus,
} from "@/lib/tauri-queries";

/**
 * /dev/speech (TASK-30 / TASK-32.3): the sherpa-onnx dev surface. The whole
 * page used to be one ~250-line component (cc 23 / cog 16); following the
 * settings-speech-models.tsx precedent each Card section is a module-level
 * subcomponent below (AutoDownloadCard / StatusCard / TtsCard / SttCard) and
 * SpeechRoute keeps only the shared state and handlers. The state must stay
 * in the parent: AutoDownloadCard's download errors are rendered by TtsCard
 * (original behavior), so text/speaking/error/downloading remain coupled.
 */

/** The three model tasks AutoDownloadCard can fetch. */
type SpeechTask = "tts" | "stt" | "vad";

/** Models-dir placeholder until `speech_status` reports the real one. */
const MODELS_DIR_PLACEHOLDER = "app_data/speech/models";

/** One auto-download button per task; labels are the pre-3.x copy. */
const AUTO_DOWNLOAD_BUTTONS: ReadonlyArray<{
  label: string;
  task: SpeechTask;
}> = [
  { label: "Download TTS (Supertonic JA)", task: "tts" },
  { label: "Download STT (SenseVoice JA)", task: "stt" },
  { label: "Download VAD", task: "vad" },
];

// TASK-32.3: Tier 1 loader (queryOptions + loader).
// Loader warms speechStatus + speechModels via ensureQueryData.
// Uses @manobu/speech models + lib/tauri-queries queryOptions.
// Matches settings.tsx loader pattern.
// Completed: loader + queryOptions (TASK-32.3).
// TASK-32.3: Tier 1 loader · speech status + models via queryOptions (TASK-30 /dev).
export const Route = createFileRoute("/dev/speech")({
  component: SpeechRoute,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(speechStatusQueryOptions),
      queryClient.ensureQueryData(speechModelsQueryOptions),
    ]),
  pendingComponent: () => (
    <div className="p-4 text-xs">Loading speech status…</div>
  ),
});

/** One auto-download button: stable onClick, non-JSX ternary label. */
const AutoDownloadButton = ({
  downloading,
  label,
  onDownload,
  task,
}: {
  downloading: SpeechTask | null;
  label: string;
  onDownload: (task: SpeechTask) => Promise<void>;
  task: SpeechTask;
}): ReactNode => {
  const start = useCallback(async (): Promise<void> => {
    await onDownload(task);
  }, [onDownload, task]);
  const text = downloading === task ? "Downloading…" : label;
  return (
    <Button
      disabled={downloading !== null}
      onClick={start}
      size="sm"
      variant="outline"
    >
      {text}
    </Button>
  );
};

/** Auto-download panel: PC-spec detection + one button per model task. */
const AutoDownloadCard = ({
  downloading,
  modelsDir,
  onDownload,
}: {
  downloading: SpeechTask | null;
  modelsDir: string | undefined;
  onDownload: (task: SpeechTask) => Promise<void>;
}): ReactNode => {
  const pc = detectPcSpec();
  const specLabel = `${pc.pc_ram_gb ?? "?"}GB RAM, ${pc.pc_cores ?? "?"} cores → ${pc.device_tier}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ZapIcon className="size-4" /> Auto-download · fit to your PC spec
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        <p className="text-muted-foreground">
          One click to fetch the best JA model for <em>your PC</em>. Detected:{" "}
          <code>{specLabel}</code> (via <code>navigator.deviceMemory</code> +
          Rust <code>sysinfo</code>). Low-end → int8/small, high-end → full.
        </p>
        <div className="flex flex-wrap gap-2">
          {AUTO_DOWNLOAD_BUTTONS.map(({ label, task }) => (
            <AutoDownloadButton
              downloading={downloading}
              key={task}
              label={label}
              onDownload={onDownload}
              task={task}
            />
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Fits spec:{" "}
          <code>{JSON.stringify({ language: "ja", task: "tts|stt|vad" })}</code>{" "}
          → picks Piper Kokoro / SenseVoice / Silero VAD. Stored in{" "}
          <code>{modelsDir ?? MODELS_DIR_PLACEHOLDER}</code>.
        </p>
      </CardContent>
    </Card>
  );
};

/** Installed-model bullets + the collapsible known-JA-models list. */
const ModelList = ({
  installedModels,
  modelsDir,
}: {
  installedModels: readonly ModelInfo[];
  modelsDir: string | undefined;
}): ReactNode =>
  installedModels.length > 0 ? (
    <ul className="list-disc pl-4">
      {installedModels.map((m) => (
        <li key={m.id}>
          {m.id} · {m.kind} {m.ready ? "✓" : "○"}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-muted-foreground">
      No models in <code>{modelsDir ?? MODELS_DIR_PLACEHOLDER}</code>. Download
      from{" "}
      <a
        className="underline"
        href="https://k2-fsa.github.io/sherpa/onnx/pretrained_models/"
        rel="noopener"
        target="_blank"
      >
        sherpa pretrained
      </a>{" "}
      or run <code>speech_known_models</code> for JA manifests (SenseVoice,
      ReazonSpeech, Piper Kokoro).
    </p>
  );

/** Readiness flags rendered in the StatusCard grid, after Models dir. */
const READY_FLAGS = [
  { key: "tts_ready", label: "TTS ready" },
  { key: "stt_ready", label: "STT ready" },
  { key: "vad_ready", label: "VAD ready" },
] as const;

/** Status panel: readiness grid + installed / known model lists. */
const StatusCard = ({
  installedModels,
  status,
}: {
  installedModels: readonly ModelInfo[];
  status: SpeechStatus | null | undefined;
}): ReactNode => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-sm">
        <ZapIcon className="size-4" /> Status
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div>Models dir: {status?.models_dir ?? "–"}</div>
        {READY_FLAGS.map(({ key, label }) => (
          <div key={key}>
            {label}: {status?.[key] ? "yes" : "no"}
          </div>
        ))}
      </div>
      <ModelList
        installedModels={installedModels}
        modelsDir={status?.models_dir}
      />
      <details className="text-[11px]">
        <summary>Known JA models</summary>
        <ul className="mt-2 list-disc pl-4">
          {knownModels().map((m) => (
            <li key={m.id}>{m.display_name}</li>
          ))}
        </ul>
      </details>
    </CardContent>
  </Card>
);

/** TTS panel: text input, [Speak], and the shared error line. */
const TtsCard = ({
  error,
  onSpeak,
  onTextChange,
  speaking,
  text,
}: {
  error: string | null;
  onSpeak: () => void;
  onTextChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  speaking: boolean;
  text: string;
}): ReactNode => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-sm">
        <VolumeIcon className="size-4" /> TTS · Text → Speech
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <InputGroup>
        <InputGroup.Textarea
          className="min-h-20"
          onChange={onTextChange}
          placeholder="Type Japanese or English..."
          value={text}
        />
      </InputGroup>
      <div className="flex gap-2">
        <Button disabled={speaking || !text.trim()} onClick={onSpeak} size="sm">
          {speaking ? "Speaking…" : "Speak"}
        </Button>
        <span className="text-muted-foreground text-xs">
          Real Supertonic engine · boot calls{" "}
          <code>initTts("sherpa-onnx-supertonic-3-tts-int8-2026-05-11")</code>{" "}
          when the voice is installed
        </span>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </CardContent>
  </Card>
);

/** STT panel: static wiring notes (mic path is handled by lib/mic-stt). */
const SttCard = (): ReactNode => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-sm">
        <MicIcon className="size-4" /> STT · Speech → Text
      </CardTitle>
    </CardHeader>
    <CardContent className="text-muted-foreground text-xs">
      <p>
        Call{" "}
        <code>
          initStt("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
        </code>{" "}
        then <code>transcribeFile("/path/to/16k.wav")</code> via{" "}
        <code>@manobu/speech/stt</code>.
      </p>
      <p className="mt-2">
        For mic, record with <code>navigator.mediaDevices.getUserMedia</code> →
        temp wav → <code>speech_stt_file</code>.
      </p>
    </CardContent>
  </Card>
);

function SpeechRoute() {
  const { data: status } = useSpeechStatus();
  const { data: models } = useSpeechModels();
  const installedModels = models ?? [];
  const [text, setText] = useState("こんにちは、元気ですか？");
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<SpeechTask | null>(null);

  const handleSpeak = useCallback(async () => {
    setError(null);
    setSpeaking(true);
    // Synchronous WebAudio capture before the first await, so playback stays
    // inside the click activation (see shared/listen-button.tsx for the why).
    const audioCtx = ensurePlaybackAudioContext();
    try {
      if (!audioCtx) {
        throw new Error("WebAudio is unavailable in this environment");
      }
      const { wav } = await speak(text);
      await playWavBytes(wav, audioCtx);
      setSpeaking(false);
    } catch (e) {
      setError(String(e));
      setSpeaking(false);
    }
  }, [text]);

  const handleTextChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
    },
    []
  );

  const handleAutoDownload = useCallback(async (task: SpeechTask) => {
    setError(null);
    setDownloading(task);
    try {
      // Fit to user spec: JA learner on desktop → pick best JA model for task
      const spec = {
        language: "ja",
        streaming: task === "stt" ? false : undefined,
        task,
      };
      await autoDownload(spec);
    } catch (e) {
      setError(String(e));
    } finally {
      setDownloading(null);
    }
  }, []);

  const isTauri = typeof window !== "undefined" && "__TAURI__" in window;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="font-medium text-base">Speech · sherpa-onnx</h1>
        <p className="text-muted-foreground text-xs/relaxed">
          Offline TTS / STT / VAD via Tauri + sherpa-onnx. 100% on-device.
        </p>
      </header>

      {!isTauri && (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="pt-4 text-xs">
            Not in Tauri · speech is desktop-only. Run{" "}
            <code>bun run desktop:dev</code> to test.
          </CardContent>
        </Card>
      )}

      <AutoDownloadCard
        downloading={downloading}
        modelsDir={status?.models_dir}
        onDownload={handleAutoDownload}
      />
      <StatusCard installedModels={installedModels} status={status} />
      <TtsCard
        error={error}
        onSpeak={handleSpeak}
        onTextChange={handleTextChange}
        speaking={speaking}
        text={text}
      />
      <SttCard />
    </div>
  );
}
