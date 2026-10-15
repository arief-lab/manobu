import { projectAcpDrillResolution } from "@manobu/acp/acp-events";
import type { ChatFrame } from "@manobu/api-contract";

import {
  isDrillItemCard,
  type TMessage,
  type TMessageDrillItem,
} from "../types";
import { upsertCard } from "./upsert";

type DrillFrame = ChatFrame & { type: "drill_item" };
type DrillFrameData = DrillFrame["data"];
type WireDrillItem = NonNullable<DrillFrameData["item"]>;
type WireDrillResolution = NonNullable<DrillFrameData["resolution"]>;

function projectItem(item: WireDrillItem | null): TMessageDrillItem["item"] {
  if (item === null) {
    return null;
  }
  return {
    anchors: [...item.anchors],
    id: item.id,
    itemType: item.itemType,
    level: item.level,
    options: [...item.options],
    ...(item.passage === undefined ? {} : { passage: item.passage }),
    prompt: item.prompt,
  };
}

function projectResolution(
  phase: DrillFrameData["phase"],
  resolution: WireDrillResolution | undefined
): TMessageDrillItem["resolution"] {
  if (phase !== "answered" || resolution === undefined) {
    return undefined;
  }
  return projectAcpDrillResolution(resolution);
}

export function foldDrillItem(prev: TMessage[], frame: DrillFrame): TMessage[] {
  const {
    drill_session_id,
    item,
    phase,
    request_id,
    resolution,
    session_id,
    snapshot,
  } = frame.data;
  const id = `drill:${request_id}`;
  const existing = prev.find((message) => message.id === id);
  const existingCard =
    existing && isDrillItemCard(existing) ? existing : undefined;
  const preserveTerminal =
    phase === "pending" &&
    existingCard !== undefined &&
    existingCard.phase !== "pending";
  let effectivePhase: TMessageDrillItem["phase"] = phase;
  if (frame.status === "error") {
    effectivePhase = "unavailable";
  } else if (preserveTerminal) {
    effectivePhase = existingCard.phase;
  }
  const effectiveItem = preserveTerminal
    ? existingCard.item
    : projectItem(item);
  const effectiveResolution =
    effectivePhase === "answered"
      ? (projectResolution(phase, resolution) ?? existingCard?.resolution)
      : undefined;
  const card: TMessageDrillItem = {
    conversation_id: frame.conversation_id,
    created_at: frame.created_at,
    drillSessionId: drill_session_id,
    hidden: frame.hidden,
    id,
    item: effectiveItem,
    msg_id: frame.msg_id,
    phase: effectivePhase,
    position: frame.position,
    requestId: request_id,
    sessionId: session_id,
    snapshot: { ...snapshot },
    status: frame.status ?? existingCard?.status,
    turn_id: frame.turn_id,
    type: "drill_item",
    ...(effectiveResolution === undefined
      ? {}
      : { resolution: effectiveResolution }),
  };
  return upsertCard(prev, card);
}
