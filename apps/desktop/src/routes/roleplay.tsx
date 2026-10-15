import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { Roleplay, RoleplayShelf } from "@/features/roleplay/roleplay";
import { sceneForKey } from "@/lib/roleplay-scenes";

const roleplaySearchSchema = z.object({
  scene: z.enum(["konbini", "interview"]).optional().catch(undefined),
});

// data: local-state — the roleplay redesign (SCR-07): no ?scene= renders
// the shelf ("who are you meeting today?"), ?scene= runs that exchange.
// The TASK-29 /learn/roleplay deep-link contract is preserved by the
// redirect stub there. Chrome-free like the reader and the worksheet —
// the exchange is the desk's focus mode; its own ← bar carries you out.
export const Route = createFileRoute("/roleplay")({
  component: RoleplayPage,
  validateSearch: roleplaySearchSchema,
});

function RoleplayPage() {
  const { scene } = Route.useSearch();
  if (!scene) {
    return <RoleplayShelf />;
  }
  const selected = sceneForKey(scene);
  return (
    <Roleplay scene={selected}>
      <Roleplay.Bar />
      <Roleplay.Thread />
      <Roleplay.Transcript />
    </Roleplay>
  );
}
