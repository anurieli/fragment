import type { ApiLogFieldSampleMode, ApiLogFieldSnapshot, ApiLogRequestSnapshot } from "./types";

const DEFAULT_SAMPLE_LIMIT = 360;
const HEAD_TAIL_SAMPLE_LIMIT = 480;

type FieldSampleMode = Exclude<ApiLogFieldSampleMode, "head-tail"> | "head-tail";

function sampleFieldValue(
  value: string,
  sampleMode: FieldSampleMode,
  maxChars: number,
): Pick<ApiLogFieldSnapshot, "sample" | "sampleMode" | "truncated"> {
  if (value.length <= maxChars) {
    return {
      sample: value,
      sampleMode: "full",
      truncated: false,
    };
  }

  if (sampleMode === "tail") {
    return {
      sample: `...${value.slice(-maxChars)}`,
      sampleMode: "tail",
      truncated: true,
    };
  }

  if (sampleMode === "head-tail") {
    const edgeChars = Math.max(80, Math.floor((maxChars - 5) / 2));
    return {
      sample: `${value.slice(0, edgeChars)}\n...\n${value.slice(-edgeChars)}`,
      sampleMode: "head-tail",
      truncated: true,
    };
  }

  return {
    sample: `${value.slice(0, maxChars)}...`,
    sampleMode: "head",
    truncated: true,
  };
}

export function createApiLogFieldSnapshot(
  key: string,
  value: string,
  options?: {
    sampleMode?: FieldSampleMode;
    maxChars?: number;
  },
): ApiLogFieldSnapshot {
  const normalizedValue = value || "";
  const requestedMode = options?.sampleMode ?? "head";
  const maxChars = options?.maxChars
    ?? (requestedMode === "head-tail" ? HEAD_TAIL_SAMPLE_LIMIT : DEFAULT_SAMPLE_LIMIT);
  const sampled = sampleFieldValue(normalizedValue, requestedMode, maxChars);

  return {
    key,
    length: normalizedValue.length,
    sample: sampled.sample,
    sampleMode: sampled.sampleMode,
    truncated: sampled.truncated,
  };
}

export function createApiLogRequestSnapshot(input: {
  requestId: string;
  modelRequested: string;
  promptTemplate: string;
  fields: ApiLogFieldSnapshot[];
}): ApiLogRequestSnapshot {
  return {
    requestId: input.requestId,
    modelRequested: input.modelRequested,
    promptTemplate: createApiLogFieldSnapshot("promptTemplate", input.promptTemplate, {
      sampleMode: "head-tail",
      maxChars: 720,
    }),
    fields: input.fields,
  };
}
