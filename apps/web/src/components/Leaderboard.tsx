export interface LeaderboardEntry {
  rank: number;
  name: string;
  score: string;
  isSelf: boolean;
}

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  selfRank: number | null;
  provisional: boolean;
}

export default function Leaderboard({ entries, selfRank, provisional }: LeaderboardProps) {
  const top = entries.slice(0, 10);
  const selfEntry = entries.find((entry) => entry.isSelf);
  const selfOutsideTop = selfEntry !== undefined && selfEntry.rank > 10;

  return (
    <section aria-label="Leaderboard">
      <div className="card-row">
        <h2>Leaderboard</h2>
        {provisional ? <span className="badge badge-provisional">Provisional</span> : null}
      </div>
      {provisional ? (
        <p className="muted">Ranks are provisional while the event is live. Official times are set by the server.</p>
      ) : null}
      <ol className="leaderboard-list">
        {top.map((entry) => (
          <li
            key={entry.rank}
            className={entry.isSelf ? "leaderboard-row leaderboard-row-self" : "leaderboard-row"}
            aria-current={entry.isSelf ? "true" : undefined}
          >
            <span className="leaderboard-rank">{entry.rank}</span>
            <span className="leaderboard-name">{entry.name}</span>
            <span className="leaderboard-score">{entry.score}</span>
            {entry.isSelf ? <span className="badge badge-self">You</span> : null}
          </li>
        ))}
      </ol>
      {selfOutsideTop && selfEntry ? (
        <div className="leaderboard-self" aria-label={`Your rank: ${selfEntry.rank}`}>
          <span className="leaderboard-rank">{selfEntry.rank}</span>
          <span className="leaderboard-name">{selfEntry.name}</span>
          <span className="leaderboard-score">{selfEntry.score}</span>
          <span className="badge badge-self">You</span>
        </div>
      ) : null}
      {selfRank === null ? <p className="muted">You are not ranked yet. Complete an objective to join the board.</p> : null}
    </section>
  );
}
