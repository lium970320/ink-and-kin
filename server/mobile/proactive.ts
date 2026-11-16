import type { ProactiveClaim, ProactiveDelivery } from "../proactive/types";
import { ENV } from "../_core/env";
import type { ProactiveTargetMode } from "../../shared/mobile";
import { getMobileSettings } from "./settings-store";
import { broadcastToMobileUser, onlineMobileDevices } from "./ws-hub";

export type ProactiveRoute = { destination: ProactiveDelivery | "mobile"; notifyMobile: boolean };

export function planMobileProactiveRoute(
  configured: ProactiveDelivery, preference: ProactiveTargetMode, mobileOnline: boolean,
): ProactiveRoute {
  if (preference === "qq_only") return { destination: configured, notifyMobile: false };
  if (preference === "mobile_only" || (preference === "mobile_first" && mobileOnline)) {
    return { destination: "mobile", notifyMobile: mobileOnline };
  }
  return { destination: configured, notifyMobile: mobileOnline && (configured === "web" || preference === "both") };
}

export async function resolveProactiveRoute(claim: ProactiveClaim): Promise<ProactiveRoute> {
  if (!ENV.mobileEnabled) return { destination: claim.policy.delivery, notifyMobile: false };
  const { userId } = claim.job;
  const { proactiveTargetMode } = await getMobileSettings(userId);
  return planMobileProactiveRoute(claim.policy.delivery, proactiveTargetMode, onlineMobileDevices(userId).size > 0);
}

export async function notifyMobileProactive(claim: ProactiveClaim, content: string) {
  const { id, userId, personaId } = claim.job;
  await broadcastToMobileUser(userId, { type: "proactive", personaId, message: {
    // The durable record is a proactive job, so use a separate ID range from chat messages.
    id: -1_000_000_000 - id, personaId, role: "assistant", content, messageType: "text", channel: "mobile",
    mediaUrl: null, mediaDuration: null, emotionalState: null, sceneId: null, mode: "daily",
    createdAt: new Date().toISOString(), replyToMessageId: null, clientMsgId: null,
    isSticker: false, excludedFromContext: true,
  } });
}
