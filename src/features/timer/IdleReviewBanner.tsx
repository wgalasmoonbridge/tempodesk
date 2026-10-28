import { useState } from "react";
import { Coffee, Hourglass, ShieldCheck } from "lucide-react";
import { Button } from "../../components/Button";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { api, normalizeError } from "../../lib/ipc";
import type { IdleAction, IdleReview } from "../../lib/types";
import { formatDuration, formatTime } from "../../lib/time";

export function IdleReviewBanner() {
  const { idleReviews, timezone, settings, refreshAll } = useAppData();
  const { pushToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (idleReviews.length === 0) return null;

  const resolve = async (review: IdleReview, action: IdleAction) => {
    setBusyId(review.id);
    try {
      const result = await api.resolveIdleReview(review.id, action);
      if (result.status === "stale") {
        pushToast({
          title: "That timer was already stopped",
          message:
            "The review was closed without changing any recorded time. Nothing was deleted.",
          tone: "warning",
        });
      } else {
        const label =
          action === "keep"
            ? "Idle time kept"
            : action === "exclude"
              ? "Idle gap removed"
              : "Timer ended at idle start";
        pushToast({
          title: label,
          message:
            action === "exclude"
              ? "The session was split into two audited entries around the idle gap."
              : action === "stop_at_idle"
                ? "The session now ends when the idle interval began."
                : "The full session remains tracked.",
          tone: "success",
        });
      }
      await refreshAll();
    } catch (error) {
      pushToast({
        title: "Could not resolve idle review",
        message: normalizeError(error).message,
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      {idleReviews.map((review) => {
        const resumed = review.activityResumedAtUtc ?? Date.now();
        const awaySeconds = Math.max(
          0,
          Math.floor((resumed - review.idleStartedAtUtc) / 1000),
        );
        const isSleep = review.kind === "sleep";
        const title = isSleep
          ? "Time across a sleep or clock gap"
          : "Idle time needs your review";
        return (
          <section
            key={review.id}
            className="banner warning"
            aria-label={title}
            role="status"
          >
            <div className="banner-icon">
              {isSleep ? <Coffee size={17} aria-hidden="true" /> : <Hourglass size={17} aria-hidden="true" />}
            </div>
            <div style={{ flex: 1 }}>
              <h3>{title}</h3>
              <p>
                {isSleep
                  ? "TempoDesk was suspended or the clock changed while a timer was running."
                  : "No keyboard or mouse input was detected while a timer was running."}{" "}
                Away from{" "}
                <strong>{formatTime(review.idleStartedAtUtc, timezone, settings.timeFormat)}</strong>{" "}
                to{" "}
                <strong>{formatTime(resumed, timezone, settings.timeFormat)}</strong> ·{" "}
                {formatDuration(awaySeconds, "compact")}
                {review.entryDescription ? ` · ${review.entryDescription}` : ""}
              </p>
              <div className="banner-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void resolve(review, "keep")}
                  disabled={busyId === review.id}
                >
                  Keep the time
                </Button>
                <Button
                  size="sm"
                  onClick={() => void resolve(review, "exclude")}
                  disabled={busyId === review.id}
                >
                  Remove idle gap
                </Button>
                <Button
                  size="sm"
                  onClick={() => void resolve(review, "stop_at_idle")}
                  disabled={busyId === review.id}
                >
                  End at idle start
                </Button>
              </div>
              <p style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7 }}>
                <ShieldCheck size={13} aria-hidden="true" />
                Removing the gap splits the session into two saved entries. Nothing is deleted
                without your choice.
              </p>
            </div>
          </section>
        );
      })}
    </>
  );
}
