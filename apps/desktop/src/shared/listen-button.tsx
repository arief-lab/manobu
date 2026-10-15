/*
 * ListenButton — the shared [🔊] TTS affordance (TASK-72, worksheet
 * extraction from setup's WordChip).
 *
 * The TTS contract is real (sherpa-onnx Supertonic `speech_tts` via
 * @manobu/speech/tts — TASK-154 replaced the silent-wav stub; the engine
 * answers only once the voice is installed and initialized, and web dev has
 * no engine at all). While speaking, the icon swaps to animated sound bars.
 * Outside Tauri the bars still pulse for a beat so the affordance reads,
 * then settle — a demo, never a fake "played".
 *
 * `onHeard` fires when the play attempt resolves (real audio started, or
 * the demo settled). Callers use it to reveal the script after the sound
 * — the worksheet's listen→read ladder. It is an affordance timer, not
 * an audio-confirmation: without an engine the reveal still happens,
 * because a learner must never dead-end on a missing model.
 */

import {
  ensurePlaybackAudioContext,
  playWavBytes,
  speak,
} from "@manobu/speech/tts";
import { Volume2Icon } from "lucide-react";
import { useCallback, useState } from "react";
import { useTtsPrefs } from "@/lib/tts-voice";

/** How long the bars demo when no engine can answer (web dev / no model). */
const DEMO_LISTEN_MS = 1100;

const SoundBars = () => (
  <span
    aria-hidden
    className="flex h-3.5 items-end gap-0.5"
    data-testid="sound-bars"
  >
    {[0, 1, 2, 3].map((i) => (
      <span
        className="setup-sound-bar h-full w-0.75 rounded-full bg-primary"
        key={i}
        style={{ animationDelay: `${i * 140}ms` }}
      />
    ))}
  </span>
);

export interface ListenButtonProps {
  /** Fire when synthesis could not run at all.
   *
   * TASK-141: this button historically swallowed the failure and played the
   * sign animation anyway, which is a reasonable demo for a worksheet and a lie
   * on a listening section - the learner taps "hear", sees a voice animate, and
   * has heard nothing. A caller that can report the unavailable state (the exam
   * does) passes this; callers that cannot keep the demo behaviour unchanged. */
  onError?: () => void;
  /** Fire when the play attempt resolves (see header note). */
  onHeard?: () => void;
  /** Override the test id (setup keeps its per-word `listen-{jp}`). */
  testId?: string;
  /** Kana/word to speak — TTS speaks the reading, not the romaji. */
  text: string;
  /** Icon size + label tone; "lg" is the worksheet's primary control. */
  variant?: "chip" | "lg";
}

export const ListenButton = ({
  onError,
  onHeard,
  testId = "listen-button",
  text,
  variant = "chip",
}: ListenButtonProps) => {
  const [speaking, setSpeaking] = useState(false);
  const { sid, speed } = useTtsPrefs();
  const onClick = useCallback(async () => {
    if (speaking) {
      return;
    }
    setSpeaking(true);
    // Open the WebAudio graph synchronously on this click turn. Tauri's
    // Linux WebKitGTK webview closes the user activation once an `await`
    // resolves, so `new Audio(url).play()` after `speak()` rejects with
    // NotAllowedError: the sound bars animate and no audio is heard. An
    // AudioContext created/resumed here keeps playback inside the gesture,
    // and `AudioBufferSourceNode.start()` is not subject to that policy.
    const audioCtx = ensurePlaybackAudioContext();
    try {
      if (!audioCtx) {
        throw new Error("WebAudio unavailable in this environment");
      }
      const { wav } = await speak(text, { sid, speed });
      await playWavBytes(wav, audioCtx);
      setSpeaking(false);
      onHeard?.();
    } catch {
      // No engine (web dev / model not initialized): demo the sign, and tell
      // the caller, because a caller that can say "audio unavailable" must not
      // be left showing a successful-looking animation.
      setTimeout(() => {
        setSpeaking(false);
        onError?.();
        onHeard?.();
      }, DEMO_LISTEN_MS);
    }
  }, [onError, sid, speed, text, speaking, onHeard]);
  const lg = variant === "lg";
  return (
    <button
      aria-busy={speaking}
      aria-label={speaking ? `Reading ${text}` : `Hear ${text}`}
      className={
        lg
          ? "flex items-center gap-2 rounded-card border border-border px-4 py-2 text-sm transition-colors hover:border-primary/60 hover:bg-accent"
          : // The icon chip is 24px visually; the ::after overlay grows
            // its hit area to 44px without shifting any layout
            // (antislop audit-001 R-03 tap targets).
            "relative rounded-md p-1 transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:bg-accent hover:text-foreground"
      }
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {speaking ? (
        <SoundBars />
      ) : (
        <Volume2Icon aria-hidden className={lg ? "size-5" : "size-4"} />
      )}
      {lg ? <span>hear it</span> : null}
    </button>
  );
};
