export type ChallengeStatus = "locked" | "available" | "in_progress" | "completed";

interface ChallengeCardProps {
  title: string;
  narrative: string;
  status: ChallengeStatus;
  points: number;
  lockedReason?: string | undefined;
}

const STATUS_LABELS: Record<ChallengeStatus, string> = {
  locked: "Locked",
  available: "Available",
  in_progress: "In progress",
  completed: "Completed"
};

export default function ChallengeCard({ title, narrative, status, points, lockedReason }: ChallengeCardProps) {
  return (
    <article className="card" aria-label={title}>
      <div className="card-row">
        <h3 className="card-title">{title}</h3>
        <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      <p className="card-narrative">{narrative}</p>
      <div className="card-row">
        <span className="card-points">
          {points} {points === 1 ? "point" : "points"}
        </span>
      </div>
      {status === "locked" && lockedReason ? (
        <p className="card-locked-reason">
          <strong>Locked:</strong> {lockedReason}
        </p>
      ) : null}
    </article>
  );
}
