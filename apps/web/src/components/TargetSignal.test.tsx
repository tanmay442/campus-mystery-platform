import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TargetSignal from "./TargetSignal";
import type { ProximityBand } from "./TargetSignal";

const BANDS: ProximityBand[] = [
  "Signal extremely weak",
  "Signal weak",
  "Signal detected",
  "Signal improving",
  "Signal strong",
  "Target reached"
];

describe("TargetSignal", () => {
  for (const band of BANDS) {
    it(`renders the band label "${band}"`, () => {
      render(<TargetSignal bearingLabel="Northeast" band={band} accuracyMeters={12} hint="Test hint" />);
      expect(screen.getByText(band)).toBeInTheDocument();
    });
  }
});
