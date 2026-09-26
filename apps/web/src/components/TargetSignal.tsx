import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

export type ProximityBand =
  | "Signal extremely weak"
  | "Signal weak"
  | "Signal detected"
  | "Signal improving"
  | "Signal strong"
  | "Target reached";

interface TargetSignalProps {
  bearingLabel: string;
  band: ProximityBand;
  accuracyMeters: number;
  hint: string;
}

function bandVariant(band: ProximityBand): "success" | "accent" | "warning" | "neutral" {
  if (band === "Target reached") return "success";
  if (band === "Signal strong" || band === "Signal improving") return "accent";
  if (band === "Signal detected") return "warning";
  return "neutral";
}

export default function TargetSignal({ bearingLabel, band, accuracyMeters, hint }: TargetSignalProps) {
  return (
    <Card>
      <VStack gap={2}>
        <Heading level={4}>Target signal</Heading>
        <Text>
          <StatusDot variant={bandVariant(band)} label={band} isPulsing={band === "Target reached"} /> Direction:{" "}
          {bearingLabel}
        </Text>
        <Text>
          Proximity: <Text weight="semibold">{band}</Text>
        </Text>
        <Text color="secondary">Location accuracy: +/- {accuracyMeters} m</Text>
        <Text>
          <Text weight="semibold">Hint:</Text> {hint}
        </Text>
      </VStack>
    </Card>
  );
}
