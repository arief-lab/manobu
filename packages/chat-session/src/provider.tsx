import {
  type ChangeEvent,
  createContext,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChatSessionActions,
  ChatSessionApi,
  ChatSessionMeta,
  ChatSessionState,
  ComposerNotice,
  NoticeTone,
} from "./chat-session-contract";
import { planComposerSend } from "./composer-send";
import {
  useAgentCatalog,
  useModelCatalog,
  usePersonaCatalog,
  useSlashCommands,
} from "./fetcher";
import { orpc } from "./orpc";
import { persistChat } from "./persistence";
import {
  mergeOpenConversation,
  type OpenConversationSeed,
  readInitialChatState,
  resolveAgentLabel,
  resolveConversationId,
  resolveConversationKnown,
  resolvePersonaLabel,
  resolveSlashSnapshotReady,
} from "./provider-initial";
import {
  type AcpCommand,
  acpCommandsToItems,
  type ConfigOptionWire,
  mergeSlashCommands,
} from "./slash";
import { useChatEngine } from "./use-chat-engine";

export type {
  ChatSessionActions,
  ChatSessionApi,
  ChatSessionMeta,
  ChatSessionState,
} from "./chat-session-contract";

const ChatSessionContext = createContext<ChatSessionApi | null>(null);

export function ChatSessionProvider({
  children,
  open = null,
  readOnly = false,
}: {
  children: ReactNode;
  /**
   * TASK-101: show a STORED conversation instead of the one the blob points
   * at (the history list's row link). The stored `agent`/`assistant` come
   * with it, and the transcript is NOT taken from the blob: the engine's
   * connect-time replay reads it from the database, so a profile that lost
   * its localStorage still gets the full conversation back.
   */
  open?: OpenConversationSeed | null;
  /**
   * TASK-58: one shared persisted conversation across surfaces is the
   * product decision — every writable surface loads and writes the same
   * blob (`manobu:chat:v1`), last writer wins. Read-only mounts (debug
   * viewers like /dev/chat-history) must NOT join the write race: set
   * `readOnly` to skip the persist effect entirely. In-memory state
   * stays per-instance (multi-mount contract), unaffected.
   */
  readOnly?: boolean;
}) {
  const initial = useMemo(
    () =>
      open
        ? mergeOpenConversation(readInitialChatState(), open)
        : readInitialChatState(),
    [open]
  );
  const [input, setInput] = useState(initial.input);
  // TASK-100: why a submission stayed in the composer (the accepted-send
  // contract in composer-send.ts). Cleared by the next accepted send, by
  // New Chat, and by the agent/persona identity resets.
  const [sendNotice, setSendNotice] = useState<ComposerNotice | null>(null);
  const { available: agents } = useAgentCatalog();
  const { available: personas, defaultPersonaId } = usePersonaCatalog();
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>(
    initial.agent
  );
  const [selectedPersona, setSelectedPersona] = useState<string | undefined>(
    initial.persona
  );
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    initial.model
  );
  const modelCatalog = useModelCatalog(selectedAgent);
  // One stable conversation id per mount, seeded from the persisted blob
  // (TASK-82): a reload RECONNECTS to the same server-side conversation
  // and the engine's connect-time history replay restores the transcript.
  // A fresh id is minted only on first run or after New Chat cleared the
  // blob (`reset` below). Opening a stored conversation (TASK-101) takes
  // that id verbatim: the server has already confirmed it, and a
  // conversation is not required to be a UUID the client can re-mint.
  const [conversationId, setConversationId] = useState(() =>
    open ? open.conversationId : resolveConversationId(initial.conversationId)
  );

  // TASK-80.5: the slash menu's data feed. The fetch snapshot is the
  // authoritative set; a live `available_commands` frame overlays it,
  // gated by version (server-stamped `created_at`) so a stale socket
  // replay can never clobber the fresh HTTP data. A newer authoritative
  // fetch re-becomes the base of the merge automatically. The snapshot
  // itself is read below, once the engine's cards answer the TASK-157
  // "does the server know this conversation" gate.
  const [overlayCommands, setOverlayCommands] = useState<AcpCommand[]>([]);
  const [configOptions, setConfigOptions] = useState<ConfigOptionWire[]>([]);
  // The authoritative snapshot's version (TanStack `dataUpdatedAt`): a
  // live push applies only when it is NEWER (slash.ts
  // `shouldApplyOverlay` pinned: (4,5)=false, (6,5)=true). A snapshot
  // refresh clears the overlay - the fetch is the fresh truth. Seeded at 0
  // and synced by the effect below, because the snapshot query now depends
  // on the engine's cards and so mounts after them; the frames it gates can
  // only arrive from a subscription, which starts after these effects.
  const authoritativeVersionRef = useRef(0);
  const lastOverlayVersionRef = useRef(0);

  const handleAvailableCommands = useCallback(
    (commands: AcpCommand[], version: number) => {
      if (
        version <= authoritativeVersionRef.current ||
        version <= lastOverlayVersionRef.current
      ) {
        return;
      }
      lastOverlayVersionRef.current = version;
      setOverlayCommands(commands);
    },
    []
  );
  const handleConfigOptions = useCallback((options: ConfigOptionWire[]) => {
    setConfigOptions(options);
  }, []);

  const {
    isSending,
    messages,
    regenerate,
    reset: engineReset,
    send: engineSend,
    status,
    stop,
  } = useChatEngine(conversationId, {
    agent: selectedAgent,
    assistant: selectedPersona,
    initialMessages: initial.messages,
    model: selectedModel,
    onAvailableCommands: handleAvailableCommands,
    onConfigOptions: handleConfigOptions,
    readOnly,
  });

  // TASK-157: the two reads that cannot answer for a conversation the server
  // never created (`chat.slashCommands` here, `chat.listMessages` in the
  // surfaces below) wait for the proof `resolveConversationKnown` defines.
  // TASK-172 splits the slash read onto a STRICTER gate: a conversation the
  // server created but never ran a turn on still answers slashCommands NOT_FOUND
  // (the session id lands inside the first turn, not at row creation), so the
  // exam paper chat, which always opens a turn-less stored conversation, 404s on
  // mount. `resolveSlashSnapshotReady` waits for a card only a live agent
  // session emits, so the read never fires against a session-less conversation.
  const conversationKnown = resolveConversationKnown({
    conversationId,
    messages,
    open,
  });
  const authoritative = useSlashCommands(
    conversationId,
    resolveSlashSnapshotReady(messages)
  );
  useEffect(() => {
    authoritativeVersionRef.current = authoritative.version;
    lastOverlayVersionRef.current = 0;
    setOverlayCommands([]);
  }, [authoritative.version]);

  // A history row can be opened while this surface is already mounted
  // (`/ai` -> `/ai?c=<id>` keeps the route component alive): move the
  // identity, drop the previous conversation's cards and draft, and let the
  // engine's subscribe effect replay the opened one from the database. The
  // `selectAgent` / `selectPersona` handlers are NOT reused: they start a
  // FRESH conversation, which is the opposite of opening a stored one.
  useEffect(() => {
    if (!open || open.conversationId === conversationId) {
      return;
    }
    engineReset();
    setConversationId(open.conversationId);
    setSelectedAgent(open.agent ?? undefined);
    setSelectedPersona(open.assistant ?? undefined);
    setSelectedModel(undefined);
    setInput("");
    setSendNotice(null);
  }, [conversationId, engineReset, open]);

  // Persist the conversation whenever it changes (messages, agent, persona,
  // model). Uses a single JSON blob, shared across surfaces by design
  // (TASK-58); best-effort in private mode. Read-only mounts skip the
  // write entirely — a debug viewer must never race the live surfaces.
  useEffect(() => {
    if (readOnly) {
      return;
    }
    persistChat({
      agent: selectedAgent,
      conversationId,
      input,
      messages,
      model: selectedModel,
      persona: selectedPersona,
    });
  }, [
    conversationId,
    input,
    messages,
    readOnly,
    selectedAgent,
    selectedModel,
    selectedPersona,
  ]);

  // Reconcile `selectedModel` against the agent's model catalog so a
  // stale id (persisted from a previous agent install) falls back to the
  // agent's current model instead of poison.
  useEffect(() => {
    if (!selectedAgent) {
      setSelectedModel(undefined);
      return;
    }
    setSelectedModel((prev) =>
      prev && modelCatalog.available.includes(prev)
        ? prev
        : (modelCatalog.current ?? undefined)
    );
  }, [modelCatalog, selectedAgent]);

  const selectAgent = useCallback(
    (agentId: string) => {
      // "" = use the server default (env-pinned ACP_AGENT_BIN)
      const next = agentId || undefined;
      if (selectedAgent === next) {
        return;
      }
      // Switching CLI does NOT wipe the conversation: the transcript is
      // stored per conversation (agent-agnostic) and every turn carries the
      // agent explicitly (`chat.send({ agent })` → `resolveHandle(agent,
      // conversationId)`), so the server spawns the new CLI's own ACP session
      // for the SAME conversation (pool key `agent::conversationId`) while the
      // learner keeps seeing the full history. Only an explicit New session
      // (`reset()`) clears it. The model catalog auto-clears via
      // `useModelCatalog(next)` re-running on the new `selectedAgent`.
      setSelectedAgent(next);
      setSelectedModel(undefined);
      setSendNotice(null);
      // The command + config options are agent-scoped: the new agent's
      // frames replace them; the stale set is dropped immediately so the
      // menu shows the new agent's own overlay as soon as it arrives.
      lastOverlayVersionRef.current = 0;
      setConfigOptions([]);
      setOverlayCommands([]);
    },
    [selectedAgent]
  );

  // TASK-80.5 (AC#2): a model switch applies on the next message AND
  // hot-switches the live session via `chat.setConfigOption` (option
  // `model`). NOT_FOUND (a fresh conversation with no live session yet)
  // degrades to the next-turn switch only: the bare catch matches this
  // file's fetcher convention.
  const switchModel = useCallback(
    (modelId: string) => {
      const next = modelId || undefined;
      if (selectedModel === next) {
        return;
      }
      setSelectedModel(next);
      if (!next) {
        return;
      }
      orpc.chat
        .setConfigOption({
          conversationId,
          optionId: "model",
          value: next,
        })
        .then((data) => {
          setConfigOptions(data.configOptions);
        })
        .catch(() => {
          // no live session yet; the next-turn path carries the switch
        });
    },
    [conversationId, selectedModel]
  );

  // TASK-80.5 (AC#2): the mode switch mirrors the model switch; the
  // mode picker renders only when a `mode` select option exists.
  const switchMode = useCallback(
    (modeId: string) => {
      orpc.chat
        .setConfigOption({
          conversationId,
          optionId: "mode",
          value: modeId,
        })
        .then((data) => {
          setConfigOptions(data.configOptions);
        })
        .catch(() => {
          // no live session yet; nothing to hot-switch
        });
    },
    [conversationId]
  );

  // TASK-80.5: the slash menu's programmatic draft insertion (`/<name> `).
  const setDraft = useCallback((text: string) => setInput(text), []);
  const setNotice = useCallback(
    (text: string | null, tone: NoticeTone = "error") => {
      setSendNotice(text === null ? null : { text, tone });
    },
    []
  );

  const selectPersona = useCallback(
    (personaId: string) => {
      const next = personaId || undefined;
      if (selectedPersona === next) {
        return;
      }
      // switching personas starts a fresh conversation, same as agents
      engineReset();
      setSelectedPersona(next);
      setSendNotice(null);
    },
    [selectedPersona, engineReset]
  );

  const send = useCallback(
    (text: string) => {
      // TASK-100: the draft is only consumed when the engine took the text.
      // Clearing it on a refused send destroyed what the caller had typed
      // ahead of a streaming turn, and the persist effect wrote the empty
      // draft to the blob, so a reload could not recover it either.
      const plan = planComposerSend(engineSend(text));
      if (plan.clearInput) {
        setInput("");
      }
      setSendNotice(
        plan.notice === null ? null : { text: plan.notice, tone: "error" }
      );
    },
    [engineSend]
  );

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      send(input);
    },
    [input, send]
  );

  const onPromptKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // TASK-79.2 (chatbot-template parity): Enter submits, Shift+Enter
      // makes a newline - but never while a Japanese IME composition is
      // active. Without the isComposing guard, pressing Enter to confirm
      // a kana conversion sends a half-built sentence.
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
    },
    []
  );

  const onInputChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value),
    []
  );

  const reset = useCallback(() => {
    setInput("");
    setSendNotice(null);
    engineReset();
    // New Chat is an EXPLICIT identity reset (TASK-82): drop the
    // persisted id so the next mount mints a fresh conversation instead
    // of reconnecting to the one just cleared.
    setConversationId(crypto.randomUUID());
  }, [engineReset]);

  // The menu shows the authoritative snapshot merged with the live
  // overlay. `mergeSlashCommands` is first-wins by name, so the overlay
  // (the agent's CURRENT command list, the freshest source) is passed
  // FIRST: on an acp<->acp name collision the live overlay copy wins;
  // builtin-vs-acp stays source-rank-driven (order-independent).
  const slashCommands = useMemo(
    () =>
      mergeSlashCommands(
        overlayCommands.length > 0 ? acpCommandsToItems(overlayCommands) : [],
        authoritative.commands
      ),
    [authoritative.commands, overlayCommands]
  );

  const selectedAgentLabel = resolveAgentLabel(agents, selectedAgent);
  const selectedPersonaLabel = resolvePersonaLabel(
    personas,
    selectedPersona,
    defaultPersonaId
  );

  const api = useMemo<ChatSessionApi>(
    () => ({
      actions: {
        onInputChange,
        onPromptKeyDown,
        onSubmit,
        regenerate,
        reset,
        selectAgent,
        selectPersona,
        send,
        setDraft,
        setNotice,
        stop,

        switchMode,
        switchModel,
      },
      meta: {
        agents,
        configOptions,
        conversationId,
        conversationKnown,
        defaultPersonaId,
        personas,
        readOnly,
        selectedAgentLabel,
        selectedPersonaLabel,
        slashCommands,
      },
      state: {
        input,
        isSending,
        messages,
        modelCatalog,
        selectedAgent,
        selectedModel,
        selectedPersona,
        sendNotice,
        status,
      },
    }),
    [
      agents,
      configOptions,
      conversationId,
      conversationKnown,
      defaultPersonaId,
      input,
      isSending,
      messages,
      modelCatalog,
      onInputChange,
      onPromptKeyDown,
      onSubmit,
      personas,
      readOnly,
      regenerate,
      reset,
      selectAgent,
      selectPersona,
      selectedAgent,
      selectedAgentLabel,
      selectedModel,
      selectedPersona,
      selectedPersonaLabel,
      sendNotice,
      send,
      setDraft,
      setNotice,
      slashCommands,

      status,
      stop,
      switchMode,
      switchModel,
    ]
  );

  return (
    <ChatSessionContext.Provider value={api}>
      {children}
    </ChatSessionContext.Provider>
  );
}

/** Read the chat-session surface; throws if no Provider above. */
export function useChatSession(): ChatSessionApi {
  const ctx = use(ChatSessionContext);
  if (!ctx) {
    throw new Error("useChatSession must be used within <ChatSessionProvider>");
  }
  return ctx;
}

/**
 * Read just the state slice. Same data as `useChatSession().state`;
 * exists so callers that only care about state can subscribe without
 * participating in actions/meta changes (the whole context is the
 * subscription, this is purely an ergonomic narrowing).
 */
export function useChatSessionState(): ChatSessionState {
  return useChatSession().state;
}

/** Read just the actions slice. */
export function useChatSessionActions(): ChatSessionActions {
  return useChatSession().actions;
}

/** Read just the meta slice. */
export function useChatSessionMeta(): ChatSessionMeta {
  return useChatSession().meta;
}
