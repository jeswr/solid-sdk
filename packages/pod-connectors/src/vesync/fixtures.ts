// AUTHORED-BY Codex GPT-6.1-Sol
// Synthetic pyvesync-shaped answers; no recorded accounts or real device identifiers.
import type { FixtureRoute } from "../core/types.js";
import { BYPASS, DEVICES, VESYNC_API } from "./api.js";
export const MODELS = ["Core300S", "Core400S", "Core600S", "LAP-V201S-AUS", "LV-PUR131S"] as const;
export const devices = MODELS.map((deviceType, i) => ({
  cid: `synthetic-purifier-${i}`,
  uuid: `synthetic-uuid-${i}`,
  deviceName: `Purifier ${i + 1}`,
  deviceType,
  deviceRegion: "US",
  connectionType: "WiFi",
}));
export const coreStatus = {
  code: 0,
  result: {
    result: {
      air_quality: 2,
      air_quality_value: 12,
      filter_life: 87,
      fan_speed_level: 2,
      mode: "auto",
      enabled: true,
    },
  },
};
export const vitalStatus = {
  code: 0,
  result: {
    result: {
      air_quality: "excellent",
      air_quality_value: 7,
      filter_life: 95,
      fan_speed_level: 1,
    },
  },
};
export const legacyStatus = {
  code: 0,
  result: {
    airQuality: "excellent",
    filterLife: 72,
    level: 1,
    mode: "manual",
    enabled: true,
  },
};
export const VESYNC_FIXTURES: readonly FixtureRoute[] = [
  { method: "POST", url: VESYNC_API + DEVICES, json: { code: 0, result: { list: [devices[0]] } } },
  { method: "POST", url: VESYNC_API + BYPASS, json: coreStatus },
];
