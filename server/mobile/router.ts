import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PROACTIVE_TARGET_MODES } from "../../shared/mobile";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import { stopMobileDeviceTurns } from "./chat";
import { getMobileApkInfo, getMobileNetwork, pairLink } from "./network";
import {
  createMobilePairingCode, getMobileDevicesForUser, getMobileSettings, requireMobileEnabled,
  revokeMobileDevice, updateMobileSettings,
} from "./settings-store";
import { disconnectMobileDevice, onlineMobileDevices } from "./ws-hub";

export async function mobileSettingsForUser(userId: number) {
  const [settings, devices] = await Promise.all([getMobileSettings(userId), getMobileDevicesForUser(userId)]);
  const online = onlineMobileDevices(userId);
  return {
    ...settings,
    onlineCount: online.size,
    hasOnlineClient: online.size > 0,
    devices: devices.map(device => ({ ...device, online: online.has(device.id) && !device.revokedAt })),
  };
}

export const mobileRouter = router({
  getOverview: protectedProcedure.query(async ({ ctx }) => ({
    ...getMobileNetwork(),
    apk: getMobileApkInfo().info,
    ...(ENV.mobileEnabled ? await mobileSettingsForUser(ctx.user.id) : {
      proactiveTargetMode: "qq_first" as const, onlineCount: 0, hasOnlineClient: false, devices: [],
    }),
  })),

  createPairingCode: protectedProcedure.input(z.object({ baseUrl: z.string().url().max(400).optional() }).optional())
    .mutation(({ ctx, input }) => {
      requireMobileEnabled();
      const network = getMobileNetwork();
      const selected = input?.baseUrl?.replace(/\/+$/, "");
      if (selected && !network.lanUrls.includes(selected) && !ENV.allowedOrigins.includes(selected)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请选择服务器的局域网地址。" });
      }
      const primaryLanUrl = selected || network.primaryLanUrl;
      const created = createMobilePairingCode(ctx.user.id);
      return {
        ...created,
        lanUrls: network.lanUrls,
        primaryLanUrl,
        landingUrl: primaryLanUrl ? `${primaryLanUrl}/api/mobile/pair/landing?code=${created.code}` : null,
        deepLinkUrl: primaryLanUrl ? pairLink(primaryLanUrl, created.code) : null,
      };
    }),

  updateSettings: protectedProcedure.input(z.object({ proactiveTargetMode: z.enum(PROACTIVE_TARGET_MODES) }))
    .mutation(async ({ ctx, input }) => {
      requireMobileEnabled();
      return { ok: true as const, ...await updateMobileSettings(ctx.user.id, input.proactiveTargetMode) };
    }),

  revokeDevice: protectedProcedure.input(z.object({ deviceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireMobileEnabled();
      const revoked = await revokeMobileDevice(ctx.user.id, input.deviceId);
      if (revoked) stopMobileDeviceTurns(ctx.user.id, input.deviceId);
      return { ok: revoked, revoked, disconnectedSockets: revoked ? disconnectMobileDevice(ctx.user.id, input.deviceId) : 0 };
    }),
});
