export type FsrsGradeName = "again" | "easy" | "good" | "hard";
export type ResponseQuality = "fast" | "slow" | "standard";

export type FsrsAttempt =
  | {
      correct: false;
      fsrsLinked: boolean;
    }
  | {
      correct: true;
      fsrsLinked: boolean;
      responseQuality: ResponseQuality;
    };

export const mapAttemptToFsrsGrade = (
  attempt: FsrsAttempt
): FsrsGradeName | null => {
  if (!attempt.fsrsLinked) {
    return null;
  }
  if (!attempt.correct) {
    return "again";
  }
  if (attempt.responseQuality === "fast") {
    return "easy";
  }
  if (attempt.responseQuality === "slow") {
    return "hard";
  }
  return "good";
};
