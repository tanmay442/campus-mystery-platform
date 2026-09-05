import { describe, expect, it } from "vitest";
import { bandForDistance, locationParamsSchema } from "./challenges";
import { eventSettingsSchema } from "./events";

describe("bandForDistance", () => {
  it("reports extremely weak beyond 250 m", () => {
    expect(bandForDistance(251)).toBe("extremely_weak");
    expect(bandForDistance(1200)).toBe("extremely_weak");
  });

  it("reports weak from 150 m to 250 m", () => {
    expect(bandForDistance(250)).toBe("weak");
    expect(bandForDistance(200)).toBe("weak");
    expect(bandForDistance(151)).toBe("weak");
  });

  it("reports detected from 80 m to 150 m", () => {
    expect(bandForDistance(150)).toBe("detected");
    expect(bandForDistance(100)).toBe("detected");
    expect(bandForDistance(81)).toBe("detected");
  });

  it("reports improving from 50 m to 80 m", () => {
    expect(bandForDistance(80)).toBe("improving");
    expect(bandForDistance(60)).toBe("improving");
    expect(bandForDistance(51)).toBe("improving");
  });

  it("reports strong from the radius up to 50 m", () => {
    expect(bandForDistance(50)).toBe("strong");
    expect(bandForDistance(30)).toBe("strong");
    expect(bandForDistance(11)).toBe("strong");
  });

  it("reports reached inside the configured radius", () => {
    expect(bandForDistance(10)).toBe("reached");
    expect(bandForDistance(4)).toBe("reached");
    expect(bandForDistance(0)).toBe("reached");
  });

  it("uses a custom radius for the reached band", () => {
    expect(bandForDistance(15, 20)).toBe("reached");
    expect(bandForDistance(25, 20)).toBe("strong");
  });
});

describe("defaults", () => {
  it("parses empty event settings with PRD defaults", () => {
    const settings = eventSettingsSchema.parse({});
    expect(settings.participation).toBe("solo_or_team");
    expect(settings.maximumTeamSize).toBe(5);
    expect(settings.winnerMode).toBe("first_to_complete");
    expect(settings.lateJoinPenaltySeconds).toBe(300);
    expect(settings.leaderboardSize).toBe(10);
    expect(settings.publicLeaderboard).toBe(true);
    expect(settings.nearbyPresence).toBe(true);
    expect(settings.platformCreditsEnabled).toBe(true);
  });

  it("parses location params with PRD 11.5 defaults", () => {
    const params = locationParamsSchema.parse({
      latitude: 28.612345,
      longitude: 77.208765
    });
    expect(params.radiusMeters).toBe(10);
    expect(params.maximumAccuracyMeters).toBe(20);
    expect(params.requiredReadings).toBe(3);
    expect(params.collectionDurationSeconds).toBe(8);
    expect(params.readingsExpireAfterSeconds).toBe(60);
  });
});
