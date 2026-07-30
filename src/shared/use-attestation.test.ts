import { describe, expect, it } from "vitest";
import {
  createLearningUseAttestation,
  LEARNING_USE_ATTESTATION_VERSION,
  parseLearningUseAttestation
} from "./use-attestation";

describe("learning-use attestation", () => {
  it("creates a versioned local learning-only confirmation", () => {
    const attestation = createLearningUseAttestation(
      new Date("2026-07-30T04:00:00.000Z")
    );

    expect(attestation).toEqual({
      version: LEARNING_USE_ATTESTATION_VERSION,
      purpose: "personal_learning",
      acceptedAt: "2026-07-30T04:00:00.000Z"
    });
    expect(
      parseLearningUseAttestation(JSON.stringify(attestation))
    ).toEqual(attestation);
  });

  it("requires the current version and a valid timestamp", () => {
    expect(parseLearningUseAttestation(undefined)).toBeUndefined();
    expect(parseLearningUseAttestation("not-json")).toBeUndefined();
    expect(
      parseLearningUseAttestation(
        JSON.stringify({
          version: LEARNING_USE_ATTESTATION_VERSION - 1,
          purpose: "personal_learning",
          acceptedAt: "2026-07-30T04:00:00.000Z"
        })
      )
    ).toBeUndefined();
    expect(
      parseLearningUseAttestation(
        JSON.stringify({
          version: LEARNING_USE_ATTESTATION_VERSION,
          purpose: "personal_learning",
          acceptedAt: "invalid"
        })
      )
    ).toBeUndefined();
  });
});
