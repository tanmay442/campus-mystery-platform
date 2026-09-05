import { useEffect, useState } from "react";

interface CountdownProps {
  targetIso: string;
  label?: string | undefined;
}

function pad(unit: number): string {
  return unit < 10 ? `0${unit}` : `${unit}`;
}

function formatRemaining(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00:00:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export default function Countdown({ targetIso, label }: CountdownProps) {
  const targetTime = Date.parse(targetIso);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (Number.isNaN(targetTime)) {
    return (
      <p role="status" className="muted">
        {label ?? "Event time"}: to be announced.
      </p>
    );
  }

  const remainingSeconds = Math.max(0, Math.floor((targetTime - now) / 1000));
  const finished = remainingSeconds <= 0;

  return (
    <div className="countdown" role="timer" aria-live="off" aria-label={label ?? "Event countdown"}>
      <span className="countdown-label">{label ?? "Starts in"}</span>
      <span className="countdown-value">{finished ? "Live now" : formatRemaining(remainingSeconds)}</span>
      <span className="muted">Official time is set by the server.</span>
    </div>
  );
}
