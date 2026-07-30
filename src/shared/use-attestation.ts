import type { LearningUseAttestation } from "./contracts";

export const LEARNING_USE_ATTESTATION_VERSION = 1;
export const LEARNING_USE_SETTING = "learningUseAttestation";

export function createLearningUseAttestation(
  now = new Date()
): LearningUseAttestation {
  return {
    version: LEARNING_USE_ATTESTATION_VERSION,
    purpose: "personal_learning",
    acceptedAt: now.toISOString()
  };
}

export function parseLearningUseAttestation(
  raw: string | undefined
): LearningUseAttestation | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<LearningUseAttestation>;
    if (
      value.version !== LEARNING_USE_ATTESTATION_VERSION ||
      value.purpose !== "personal_learning" ||
      typeof value.acceptedAt !== "string" ||
      !Number.isFinite(Date.parse(value.acceptedAt))
    ) {
      return undefined;
    }
    return {
      version: value.version,
      purpose: value.purpose,
      acceptedAt: value.acceptedAt
    };
  } catch {
    return undefined;
  }
}
