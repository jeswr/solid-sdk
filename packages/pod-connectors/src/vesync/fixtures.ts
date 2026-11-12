// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
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
// bypassV2 nests the device's own code/result; VeSyncAirBypass reads `level` for the fan.
export const coreStatus = {
  code: 0,
  result: {
    code: 0,
    result: {
      air_quality: 2,
      air_quality_value: 12,
      filter_life: 87,
      level: 2,
      mode: "auto",
      enabled: true,
    },
  },
};
// VeSyncAirBaseV2 (Vital 100S/200S) uses camelCase status keys.
export const vitalStatus = {
  code: 0,
  result: {
    code: 0,
    result: {
      AQLevel: 1,
      PM25: 7,
      filterLifePercent: 95,
      fanSpeedLevel: 1,
      powerSwitch: 1,
      workMode: "auto",
    },
  },
};
// VeSyncAir131 reads deviceDetail at the top level; filterLife is an object with `percent`.
export const legacyStatus = {
  code: 0,
  msg: "request success",
  airQuality: "excellent",
  filterLife: { change: false, useHour: 120, percent: 72 },
  level: 1,
  mode: "manual",
  deviceStatus: "on",
};
export const VESYNC_FIXTURES: readonly FixtureRoute[] = [
  { method: "POST", url: VESYNC_API + DEVICES, json: { code: 0, result: { list: [devices[0]] } } },
  { method: "POST", url: VESYNC_API + BYPASS, json: coreStatus },
];
