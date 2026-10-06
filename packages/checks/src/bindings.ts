import type { CheckHandler } from "./contract.js";
import { safeLabel, safeSha } from "./input.js";

/** Metadata comparisons only: no Git, environment, receipt, or owner probing. */
export const shaMatches: CheckHandler = ({ definition }) => {
  const { params } = definition;
  return Object.keys(params).length === 2 && safeSha(params.expected) && safeSha(params.actual) &&
    params.expected.toLowerCase() === params.actual.toLowerCase();
};

export const envMatches: CheckHandler = ({ definition }) => {
  const { params } = definition;
  return Object.keys(params).length === 2 && safeLabel(params.expected) && safeLabel(params.actual) &&
    params.expected === params.actual;
};
