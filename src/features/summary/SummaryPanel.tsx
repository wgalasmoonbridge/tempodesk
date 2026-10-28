import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Loader2,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "../../components/Button";
import { useToast } from "../../components/Toast";
import { useAppData } from "../../app/AppProvider";
import { useNavigation } from "../../app/navigation";
import { api, normalizeError } from "../../lib/ipc";
import type { ReportFilter, SummaryResult } from "../../lib/types";
import { formatDuration } from "../../lib/time";

interface SummaryPanelProps {
  filter: ReportFilter;
  /// Used inside dialogs to reduce outer spacing.
  embedded?: boolean;
}

function filterKey(filter: ReportFilter): string {
  return [
    filter.dateFrom,
    filter.dateTo,
    filter.timezone,
    filter.projectId ?? "",
    filter.clientId ?? "",
    filter.tagId ?? "",
    filter.billable === null || filter.billable === undefined
      ? ""
      : String(filter.billable),
    filter.search ?? "",
  ].join("|");
}

export function SummaryPanel({ filter, embedded }: SummaryPanelProps) {
  const { aiStatus, settings } = useAppData();
  const { navigate } = useNavigation();
  const { pushToast } = useToast();
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [loading, setLoading] = useState<"local" | "ai" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const key = filterKey(filter);
  useEffect(() => {
    setSummary(null);
    setError(null);
    setCopied(false);
  }, [key]);

  const aiReady = Boolean(
    aiStatus?.enabled &&
      aiStatus.consent &&
      aiStatus.keyConfigured &&
      !aiStatus.keyError,
  );
  const aiReason = useMemo(() => {
    if (!aiStatus) return "Checking AI configuration…";
    if (aiStatus.keyError) return aiStatus.keyError;
    if (!aiStatus.keyConfigured) return "Add a Gemini API key in Settings to enable AI summaries.";
    if (!aiStatus.enabled) return "AI summaries are turned off in Settings.";
    if (!aiStatus.consent) return "Confirm the AI data-sharing notice in Settings.";
    return null;
  }, [aiStatus]);

  const run = async (useAi: boolean) => {
    setLoading(useAi ? "ai" : "local");
    setError(null);
    setCopied(false);
    try {
      const result = await api.generateSummary(filter, useAi);
      setSummary(result);
    } catch (err) {
      setError(normalizeError(err).message);
    } finally {
      setLoading(null);
    }
  };

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      pushToast({
        title: "Could not copy the summary",
        message: "Select the text and copy it manually.",
        tone: "error",
      });
    }
  };

  return (
    <section
      className={`summary-panel${embedded ? " embedded" : ""}`}
      aria-labelledby="summary-heading"
      aria-busy={loading !== null}
    >
      <div className="summary-head">
        <Sparkles size={16} aria-hidden="true" />
        <h2 id="summary-heading">High-level summary</h2>
        {summary ? (
          <span
            className={`badge ${summary.mode === "ai" ? "badge-accent" : "badge-teal"}`}
          >
            {summary.mode === "ai"
              ? `${summary.provider ?? "AI"} · ${summary.model ?? "model"}`
              : "Local · offline"}
          </span>
        ) : null}
        <div className="summary-actions">
          {summary ? (
            <Button
              size="sm"
              icon={
                copied ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <Copy size={13} aria-hidden="true" />
                )
              }
              onClick={() => void copy()}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            icon={
              loading ? (
                <Loader2 size={13} aria-hidden="true" className="spin" />
              ) : (
                <Sparkles size={13} aria-hidden="true" />
              )
            }
            onClick={() => void run(aiReady)}
            disabled={loading !== null}
            title={
              aiReady
                ? "Send this range's aggregated data to Gemini"
                : "Generate locally without any network request"
            }
          >
            {loading
              ? "Generating…"
              : aiReady
                ? "Generate AI summary"
                : "Generate summary"}
          </Button>
          {aiReady ? (
            <Button
              size="sm"
              onClick={() => void run(false)}
              disabled={loading !== null}
              title="Generate a summary locally without network access"
            >
              Local only
            </Button>
          ) : null}
        </div>
      </div>

      <p className="summary-range">
        {formatSummaryRange(filter)} · {filter.timezone}
        {aiReady && !settings.aiIncludeDescriptions
          ? " · task descriptions excluded from AI request"
          : ""}
      </p>

      {error ? (
        <div className="dialog-error" role="alert">
          <span>{error}</span>
          <Button size="sm" onClick={() => void run(false)} disabled={loading !== null}>
            Use local summary
          </Button>
        </div>
      ) : null}

      {!aiReady ? (
        <div className="summary-setup">
          <span>
            <ShieldCheck size={13} aria-hidden="true" /> {aiReason}
          </span>
          <Button
            size="sm"
            icon={<Settings2 size={13} aria-hidden="true" />}
            onClick={() => navigate("settings")}
          >
            AI settings
          </Button>
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="summary-meta">
            <span>{summary.rangeLabel}</span>
            <span>·</span>
            <span>{formatDuration(summary.totalSeconds, "hm")} tracked</span>
            <span>·</span>
            <span>
              {new Date(summary.generatedAtUtc).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <pre className="summary-text">{summary.text}</pre>
          {summary.warning ? (
            <p className="field-hint">{summary.warning}</p>
          ) : null}
        </>
      ) : (
        <p className="summary-empty">
          Generate a concise overview of this period: totals, billable split, busiest days,
          project/client distribution, and top tasks. AI is optional — the local summary works
          fully offline.
        </p>
      )}

      <p className="summary-privacy">
        <ShieldCheck size={13} aria-hidden="true" />
        When you click Generate with AI enabled, only the aggregated timesheet data for this range
        is sent to Gemini. Nothing is sent in the background. The API key is stored in the OS
        credential store and is never included in backups.
      </p>
    </section>
  );
}

function formatSummaryRange(filter: ReportFilter): string {
  return filter.dateFrom === filter.dateTo
    ? filter.dateFrom
    : `${filter.dateFrom} – ${filter.dateTo}`;
}
