export const MOBILE_SERVICE = "ink-and-kin";
export const MOBILE_PROTOCOL_VERSION = 1;
export const MOBILE_PAIR_SCHEME = "ink-and-kin://pair";
export const MOBILE_DISCOVERY_REQUEST = "INK_AND_KIN_DISCOVER";
export const MOBILE_DISCOVERY_PORT = 30003;

export const PROACTIVE_TARGET_MODES = [
  "mobile_first",
  "both",
  "qq_first",
  "mobile_only",
  "qq_only",
] as const;

export type ProactiveTargetMode = (typeof PROACTIVE_TARGET_MODES)[number];
