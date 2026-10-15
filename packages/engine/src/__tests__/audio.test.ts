import { describe, expect, test } from "bun:test";
import { mulberry32 } from "@buckshot/core";
import { brownNoise, MASTER_VOLUME, SHOT_LAYERS } from "../audio";

const SAMPLE_RATE = 48_000;
/** The launch shot: its layer peaks summed to 2.77, sent through a master volume of 0.75. */
const OLD_SHOT_INTO_COMPRESSOR = 2.77 * 0.75;
/** Half the amplitude: at least 6 dB softer into the compressor. */
const SIX_DB_DOWN = 0.5;

describe("brownNoise", () => {
  const data = brownNoise(SAMPLE_RATE * 2, mulberry32(7));
  const maxStep = (samples: Float32Array): number => {
    let step = 0;
    for (let index = 1; index < samples.length; index += 1) {
      step = Math.max(
        step,
        Math.abs((samples[index] ?? 0) - (samples[index - 1] ?? 0))
      );
    }
    return step;
  };

  test("loops without a jump: the wrap step is no bigger than any step inside", () => {
    const wrap = Math.abs((data[0] ?? 0) - (data.at(-1) ?? 0));
    expect(wrap).toBeLessThanOrEqual(maxStep(data));
  });

  test("stays within a sane amplitude", () => {
    const peak = data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThan(1.5);
  });

  test("is smooth (brown): neighbouring samples barely move compared with the signal", () => {
    const peak = data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(maxStep(data) / peak).toBeLessThan(0.2);
  });

  test("is centred: no DC offset left over from the integrator", () => {
    const mean = data.reduce((sum, value) => sum + value, 0) / data.length;
    const peak = data.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(Math.abs(mean) / peak).toBeLessThan(1e-4);
  });
});

describe("SHOT_LAYERS", () => {
  test("every layer fades in over at least 3 ms, so the shot never clicks", () => {
    for (const layer of SHOT_LAYERS) {
      expect(layer.options.attack).toBeGreaterThanOrEqual(0.003);
    }
  });

  test("no layer is a high-passed crack", () => {
    for (const layer of SHOT_LAYERS) {
      if (layer.kind === "noise") {
        expect(layer.options.filter).not.toBe("highpass");
      }
    }
  });

  // The summed peaks are an upper bound on what the shot sends the master compressor. It still
  // gets some gain reduction (see SHOT_LAYERS); this guards against it going back to the old level.
  test("goes into the compressor at least 6 dB softer than the old shot", () => {
    const summed = SHOT_LAYERS.reduce(
      (sum, layer) => sum + layer.options.peak,
      0
    );
    expect(summed * MASTER_VOLUME).toBeLessThan(
      OLD_SHOT_INTO_COMPRESSOR * SIX_DB_DOWN
    );
  });
});
