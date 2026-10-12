import { types } from "node:util";
import { snapshotPairMeasurement, aggregatePairedMeasurements } from "./paired-evaluation-data.mjs";

const DERIVED = ["tokens", "sdk_cost", "cost_priced"];
const USAGE_REQUIRED = ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"];
const USAGE_OPTIONAL = ["cacheWrite1h", "reasoning"];
const COST_KEYS = ["input", "output", "cacheRead", "cacheWrite", "total"];
const refused = () => { throw Error("stage6-k1-metrics-refused"); };
function own(input, allowed, required = allowed, optionalUndefined = []) {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) refused();
  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length || keys.some(key => typeof key !== "string" || !allowed.includes(key))) refused();
  const value = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined && !optionalUndefined.includes(key)) refused();
    value[key] = descriptor.value;
  }
  if (required.some(key => !Object.hasOwn(value, key))) refused();
  return value;
}
function measurementInput(input) {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) refused();
  const keys = Reflect.ownKeys(input);
  if (keys.length > 64 || keys.some(key => typeof key !== "string" || DERIVED.includes(key))) refused();
  // The existing paired parser owns the required row fields and pins. This
  // adapter snapshots descriptors only; it does not replicate that schema.
  return own(input, keys);
}
function count(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) refused();
  return value;
}
function price(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) refused();
  return value;
}
function usageInput(input) {
  const usage = own(input, [...USAGE_REQUIRED, ...USAGE_OPTIONAL], USAGE_REQUIRED, USAGE_OPTIONAL);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) count(usage[key]);
  const reasoning = usage.reasoning === undefined ? null : count(usage.reasoning);
  if (reasoning !== null && reasoning > usage.output) refused();
  if (usage.cacheWrite1h !== undefined && count(usage.cacheWrite1h) > usage.cacheWrite) refused();
  const cost = own(usage.cost, COST_KEYS);
  for (const key of COST_KEYS) price(cost[key]);
  return Object.freeze({
    tokens: Object.freeze({ input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite, reasoning, total: usage.totalTokens }),
    sdk_cost: cost.total === 0 ? null : cost.total, cost_priced: cost.total > 0,
  });
}

/** Compose a complete trusted-host measurement with public SDK Usage DATA.
 * No SDK/profile/model/bank is touched. The parser validates metadata, not
 * collection authenticity, provider billing, current proof or execution rights.
 * Reasoning/cacheWrite1h are subsets and never added again to SDK totalTokens.
 */
export function adaptK1SDKMeasurement(input) {
  try {
    const value = own(input, ["measurement", "usage"]);
    const measurement = measurementInput(value.measurement);
    const derived = usageInput(value.usage);
    return snapshotPairMeasurement({ ...measurement, ...derived });
  } catch { throw Error("stage6-k1-metrics-refused"); }
}

/** Exactly eight complete records; the original paired aggregator owns pair
 * identity, condition equality, request limits and failure/UNKNOWN semantics.
 */
export function aggregateK1SDKMeasurements(input) {
  try {
    if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length !== 8 || Reflect.ownKeys(input).length !== 9) refused();
    const rows = [];
    for (let index = 0; index < input.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) refused();
      rows.push(adaptK1SDKMeasurement(descriptor.value));
    }
    const aggregate = aggregatePairedMeasurements(rows);
    // Finite row estimates/durations can still overflow when summed. Refuse
    // rather than let JSON serialize Infinity as a misleading null/unknown.
    const pending = [aggregate];
    while (pending.length) {
      const value = pending.pop();
      if (typeof value === "number" && !Number.isFinite(value)) refused();
      else if (value !== null && typeof value === "object") pending.push(...Object.values(value));
    }
    return aggregate;
  } catch { throw Error("stage6-k1-metrics-refused"); }
}
