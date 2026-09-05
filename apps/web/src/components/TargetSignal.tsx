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

export default function TargetSignal({ bearingLabel, band, accuracyMeters, hint }: TargetSignalProps) {
  return (
    <section className="target-signal" aria-label="Target signal">
      <h2 className="target-signal-heading">TARGET SIGNAL</h2>
      <dl className="target-signal-facts">
        <div className="target-signal-row">
          <dt>Direction:</dt>
          <dd>{bearingLabel}</dd>
        </div>
        <div className="target-signal-row">
          <dt>Proximity:</dt>
          <dd>{band}</dd>
        </div>
        <div className="target-signal-row">
          <dt>Location accuracy:</dt>
          <dd>+/- {accuracyMeters} m</dd>
        </div>
      </dl>
      <div className="target-signal-hint">
        <p className="target-signal-hint-label">Hint:</p>
        <p className="target-signal-hint-text">{hint}</p>
      </div>
    </section>
  );
}
