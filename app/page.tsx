"use client";

import { useRef, useState, useEffect, Fragment } from "react";
import Papa from "papaparse";
import { buildScorecard, parseTransactions } from "@/lib/scorecard";
import { SAMPLE_TRANSACTIONS, SAMPLE_FIRM_NAME } from "@/lib/sampleData";
import type { ScorecardResult, Anomaly, AnomalyType } from "@/lib/types";

function formatHoursMins(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = Math.round(totalMins % 60);
  if (h === 0) return `${m} mins`;
  return `${h} hrs ${m} mins`;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "#2D9B5A";
  if (score >= 40) return "#F4A261";
  return "#E63946";
}

const ISSUE_TYPE_LABELS: Record<AnomalyType, string> = {
  duplicate: "Duplicate Entries",
  unreconciled: "Unreconciled Items",
  miscategorized: "Miscategorized",
  ap_aging: "AP Aging (Unpaid Bills)",
  ar_aging: "AR Aging (Uncollected)",
  round_number: "Round Number Estimates",
  ghost_transaction: "Ghost Transactions",
  expense_spike: "Expense Spike",
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

type SortKey = "type" | "account" | "count" | "dollarExposure" | "totalManualFixMins" | "severity";

export default function Home() {
  const [result, setResult] = useState<ScorecardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [expandedAnomalyKey, setExpandedAnomalyKey] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"buyer" | "seller">("buyer");
  const [parseError, setParseError] = useState<string | null>(null);
  const [anomalySort, setAnomalySort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "severity",
    dir: "desc",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!result) return;
    const target = result.scores.overall;
    const duration = 1200;
    const start = performance.now();
    let rafId: number;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      setAnimatedScore(Math.round(target * easeOut(t)));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [result?.scores.overall]);

  useEffect(() => {
    if (result) setViewMode(result.viewMode);
  }, [result?.viewMode]);

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) return;
    setLoading(true);
    setParseError(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => {
        try {
          const rows = (parsed.data ?? []) as Record<string, string>[];
          const transactions = parseTransactions(rows);
          const scorecard = buildScorecard(
            transactions,
            file.name.replace(/\.csv$/i, "") || "Firm"
          );
          setResult(scorecard);
        } catch (err) {
          setParseError(err instanceof Error ? err.message : "Failed to parse CSV");
        }
        setLoading(false);
      },
      error: (err) => {
        setParseError(err.message || "Failed to parse CSV");
        setLoading(false);
      },
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const loadSample = () => {
    setParseError(null);
    setResult(buildScorecard(SAMPLE_TRANSACTIONS, SAMPLE_FIRM_NAME));
  };

  const setViewModeAndResult = (mode: "buyer" | "seller") => {
    setViewMode(mode);
    if (result) setResult({ ...result, viewMode: mode });
  };

  const sortedAnomalies: Anomaly[] = result
    ? [...result.anomalies].sort((a, b) => {
        const k = anomalySort.key;
        if (k === "severity") {
          const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
          return anomalySort.dir === "desc" ? -diff : diff;
        }
        if (k === "type" || k === "account") {
          const cmp = String(a[k]).localeCompare(String(b[k]));
          return anomalySort.dir === "desc" ? -cmp : cmp;
        }
        const va =
          k === "dollarExposure"
            ? a.dollarExposure
            : k === "totalManualFixMins"
              ? a.totalManualFixMins
              : a.count;
        const vb =
          k === "dollarExposure"
            ? b.dollarExposure
            : k === "totalManualFixMins"
              ? b.totalManualFixMins
              : b.count;
        const diff = va - vb;
        return anomalySort.dir === "desc" ? -diff : diff;
      })
    : [];

  const toggleSort = (key: SortKey) => {
    setAnomalySort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }));
  };

  const sectionClass = "opacity-0 animate-fade-in-up";

  if (result === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-quanto-teal">Quanto</h1>
          <p className="text-quanto-navy text-sm tracking-widest uppercase mt-1">
            Firm Health Scorecard
          </p>
        </div>
        <div
          className={`w-full max-w-lg rounded-2xl border-2 border-dashed p-12 text-center transition-colors cursor-pointer mx-auto
            ${dragOver ? "border-quanto-teal bg-quanto-teal-bg" : "border-border-subtle bg-card"}
          `}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 border-4 border-quanto-teal border-t-transparent rounded-full animate-spin" />
              <p className="text-quanto-navy font-medium">Processing…</p>
            </div>
          ) : (
            <>
              <svg className="w-12 h-12 mx-auto text-border-subtle mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-quanto-navy font-medium">Drop a QuickBooks export (.csv)</p>
              <p className="text-text-muted text-sm mt-1">or click to browse files</p>
            </>
          )}
        </div>
        {parseError && (
          <p className="mt-3 text-score-red text-sm">{parseError}</p>
        )}
        <p className="text-text-muted text-sm mt-4">or</p>
        <button
          type="button"
          onClick={loadSample}
          disabled={loading}
          className="mt-4 px-6 py-3 rounded-xl bg-quanto-navy text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
        >
          Load Sample Firm
        </button>
        <p className="text-xs text-text-muted mt-8 max-w-sm text-center">
          Instant due diligence on any QuickBooks file. No data is stored.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-quanto-navy">
      <Header
        result={result}
        viewMode={viewMode}
        setViewModeAndResult={setViewModeAndResult}
        animatedScore={animatedScore}
        sectionClass={sectionClass}
      />
      <ScoreBreakdown result={result} viewMode={viewMode} sectionClass={sectionClass} />
      <StatCards result={result} sectionClass={sectionClass} />
      <TopIssueSection result={result} viewMode={viewMode} sectionClass={sectionClass} />
      <AnomalyTable
        result={result}
        sortedAnomalies={sortedAnomalies}
        anomalySort={anomalySort}
        toggleSort={toggleSort}
        expandedAnomalyKey={expandedAnomalyKey}
        setExpandedAnomalyKey={setExpandedAnomalyKey}
        viewMode={viewMode}
        sectionClass={sectionClass}
      />
      <AccountHealthSection result={result} sectionClass={sectionClass} />
      <CleanupSummary result={result} viewMode={viewMode} sectionClass={sectionClass} />
      <Footer sectionClass={sectionClass} />
    </div>
  );
}

function Header({
  result,
  viewMode,
  setViewModeAndResult,
  animatedScore,
  sectionClass,
}: {
  result: ScorecardResult;
  viewMode: "buyer" | "seller";
  setViewModeAndResult: (m: "buyer" | "seller") => void;
  animatedScore: number;
  sectionClass: string;
}) {
  return (
    <section
      id="header"
      className={`${sectionClass} border-b border-border-subtle bg-card px-8 py-6 flex flex-wrap items-center justify-between gap-6`}
      style={{ animationDelay: "0ms" }}
    >
      <div>
        <p className="text-quanto-teal font-bold">Quanto</p>
        <h1 className="text-2xl font-bold text-quanto-navy mt-1">{result.firmName}</h1>
        <p className="text-text-muted text-sm mt-1">
          Generated {result.generatedAt.toLocaleDateString()} · {viewMode === "buyer" ? "Buyer View" : "Seller View"}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex rounded-full overflow-hidden border border-border-subtle bg-surface">
          <button
            type="button"
            onClick={() => setViewModeAndResult("buyer")}
            className={`px-4 py-2 text-sm font-medium ${viewMode === "buyer" ? "bg-quanto-navy text-white" : "text-quanto-navy"}`}
          >
            Buyer View
          </button>
          <button
            type="button"
            onClick={() => setViewModeAndResult("seller")}
            className={`px-4 py-2 text-sm font-medium ${viewMode === "seller" ? "bg-quanto-navy text-white" : "text-quanto-navy"}`}
          >
            Seller View
          </button>
        </div>
        <div className="flex flex-col items-center">
          <svg width={140} height={140} className="flex-shrink-0">
            <circle cx={70} cy={70} r={58} fill="none" stroke="#E2E8F0" strokeWidth={10} />
            <circle
              cx={70}
              cy={70}
              r={58}
              fill="none"
              stroke={getScoreColor(animatedScore)}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 58}
              strokeDashoffset={2 * Math.PI * 58 * (1 - animatedScore / 100)}
              transform="rotate(-90 70 70)"
            />
            <text x={70} y={64} textAnchor="middle" className="text-2xl font-bold fill-quanto-navy">
              {animatedScore}
            </text>
            <text x={70} y={82} textAnchor="middle" className="text-sm fill-text-muted">
              /100
            </text>
          </svg>
          <span
            className="text-sm font-semibold mt-1"
            style={{ color: getScoreColor(animatedScore) }}
          >
            Grade: {result.scores.grade}
          </span>
        </div>
      </div>
    </section>
  );
}

function ScoreBreakdown({
  result,
  viewMode,
  sectionClass,
}: {
  result: ScorecardResult;
  viewMode: "buyer" | "seller";
  sectionClass: string;
}) {
  const sublabels: Record<string, { buyer: string; seller: string }> = {
    dataQuality: { buyer: "How auditable are these books?", seller: "How clean are your books?" },
    acquisitionRisk: { buyer: "Risk score — lower is worse", seller: "Risk profile for a potential buyer" },
    automationPotential: { buyer: "How much can Quanto automate?", seller: "How much manual work could be eliminated?" },
    marginExpansion: { buyer: "Projected margin recovery with Quanto", seller: "Revenue you're leaving on the table" },
  };
  const keys = ["dataQuality", "acquisitionRisk", "automationPotential", "marginExpansion"] as const;
  const labels: Record<string, string> = {
    dataQuality: "Data Quality",
    acquisitionRisk: "Acquisition Risk",
    automationPotential: "Automation Potential",
    marginExpansion: "Margin Expansion",
  };
  const r = 36;
  const circumference = 2 * Math.PI * r;
  return (
    <section
      id="score_breakdown"
      className={`${sectionClass} max-w-6xl mx-auto px-4 py-8`}
      style={{ animationDelay: "100ms" }}
    >
      <h2 className="text-lg font-semibold text-quanto-navy mb-4">Score Breakdown</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {keys.map((key) => {
          const value = key === "acquisitionRisk" ? 100 - result.scores[key] : result.scores[key];
          return (
            <div
              key={key}
              className="bg-card border border-border-subtle rounded-2xl p-6 shadow-sm"
            >
              <p className="text-xs uppercase tracking-widest text-text-muted">{labels[key]}</p>
              <p className="text-sm text-text-muted mt-1">
                {viewMode === "buyer" ? sublabels[key].buyer : sublabels[key].seller}
              </p>
              <div className="flex items-center gap-4 mt-3">
                <svg width={80} height={80} className="flex-shrink-0">
                  <circle cx={40} cy={40} r={r} fill="none" stroke="#E2E8F0" strokeWidth={6} />
                  <circle
                    cx={40}
                    cy={40}
                    r={r}
                    fill="none"
                    stroke={getScoreColor(value)}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - value / 100)}
                    transform="rotate(-90 40 40)"
                  />
                </svg>
                <span className="text-3xl font-bold" style={{ color: getScoreColor(value) }}>
                  {Math.round(value)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatCards({ result, sectionClass }: { result: ScorecardResult; sectionClass: string }) {
  const cards = [
    {
      label: "Avg Reconciliation Lag",
      value: result.avgReconciliationLagDays,
      unit: " days",
      warn: 7,
      critical: 14,
      fixedColor: null as string | null,
    },
    {
      label: "Total Dollar Exposure",
      value: result.totalDollarExposure,
      unit: "",
      format: "currency" as const,
      fixedColor: "text-score-red",
    },
    {
      label: "Hours Lost / Month",
      value: result.hoursLostPerMonth,
      unit: " hrs",
      warn: 5,
      critical: 15,
      fixedColor: null as string | null,
    },
    {
      label: "Annual Savings Potential",
      value: result.projectedAnnualSavings,
      unit: "",
      format: "currency" as const,
      fixedColor: "text-quanto-teal",
    },
  ];
  return (
    <section
      id="stat_cards"
      className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
      style={{ animationDelay: "200ms" }}
    >
      <h2 className="text-lg font-semibold text-quanto-navy mb-4">Key Metrics</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const color =
            c.fixedColor ||
            (c.value >= (c.critical ?? 0)
              ? "text-score-red"
              : c.value >= (c.warn ?? 0)
                ? "text-score-amber"
                : "text-quanto-navy");
          const display =
            "format" in c && c.format === "currency"
              ? `$${Number(c.value).toLocaleString()}`
              : `${c.value}${c.unit ?? ""}`;
          return (
            <div
              key={c.label}
              className="bg-card border border-border-subtle rounded-2xl p-6 shadow-sm"
            >
              <p className="text-xs uppercase tracking-widest text-text-muted">{c.label}</p>
              <p className={`text-5xl font-bold ${color} mt-1`}>{display}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TopIssueSection({
  result,
  viewMode,
  sectionClass,
}: {
  result: ScorecardResult;
  viewMode: "buyer" | "seller";
  sectionClass: string;
}) {
  const top = result.topIssue;
  const estimatedValue = Math.round((top.timeSavedMins / 60) * 150);
  const severityClass =
    top.severity === "high"
      ? "bg-score-red-bg text-score-red"
      : top.severity === "medium"
        ? "bg-score-amber-bg text-score-amber"
        : "bg-surface text-text-muted";
  return (
    <section
      id="top_issue"
      className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
      style={{ animationDelay: "300ms" }}
    >
      <div className="border-l-4 border-quanto-teal bg-quanto-teal-bg rounded-2xl p-6">
        <div className="flex justify-between items-start">
          <p className="text-xs uppercase tracking-widest text-quanto-teal font-semibold">
            ⚡ Top Priority Issue
          </p>
          <span className={`px-2 py-1 rounded text-xs font-medium ${severityClass}`}>
            {top.severity}
          </span>
        </div>
        <p className="text-lg font-medium text-quanto-navy mt-2">{top.plainEnglishDescription}</p>
        {viewMode === "buyer" && (
          <p className="text-quanto-navy text-sm mt-1">
            This represents inherited risk of ${top.dollarExposure.toLocaleString()}.
          </p>
        )}
        {viewMode === "seller" && (
          <p className="text-quanto-navy text-sm mt-1">
            Resolving this could improve your valuation multiple.
          </p>
        )}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-sm text-text-muted">Manual Fix Time</p>
            <p className="text-score-red font-bold">{formatHoursMins(top.totalManualFixMins)}</p>
          </div>
          <div>
            <p className="text-sm text-text-muted">With Quanto</p>
            <p className="text-score-green font-bold">{top.quantoFixTime}</p>
          </div>
        </div>
        <p className="text-quanto-teal font-semibold mt-3">
          Time saved: {formatHoursMins(top.timeSavedMins)} — estimated value: ${estimatedValue.toLocaleString()}
        </p>
      </div>
    </section>
  );
}

function AnomalyTable({
  result,
  sortedAnomalies,
  anomalySort,
  toggleSort,
  expandedAnomalyKey,
  setExpandedAnomalyKey,
  viewMode,
  sectionClass,
}: {
  result: ScorecardResult;
  sortedAnomalies: Anomaly[];
  anomalySort: { key: SortKey; dir: "asc" | "desc" };
  toggleSort: (k: SortKey) => void;
  expandedAnomalyKey: string | null;
  setExpandedAnomalyKey: (k: string | null) => void;
  viewMode: "buyer" | "seller";
  sectionClass: string;
}) {
  const SortArrow = ({ col }: { col: SortKey }) =>
    anomalySort.key === col ? (
      <span className="ml-1">{anomalySort.dir === "desc" ? "↓" : "↑"}</span>
    ) : null;
  const severityClass = (s: string) =>
    s === "high"
      ? "bg-score-red-bg text-score-red"
      : s === "medium"
        ? "bg-score-amber-bg text-score-amber"
        : "bg-surface text-text-muted";
  return (
    <section
      id="anomaly_table"
      className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
      style={{ animationDelay: "400ms" }}
    >
      <h2 className="text-lg font-semibold text-quanto-navy mb-1">Anomaly Breakdown</h2>
      <p className="text-sm text-text-muted mb-4">
        {viewMode === "buyer"
          ? "Every flagged item below is a risk you inherit. Click any row to see the exact transactions."
          : "Every flagged item below is suppressing your valuation. Click to see what needs fixing."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full bg-card border border-border-subtle rounded-2xl overflow-hidden shadow-sm">
          <thead>
            <tr className="bg-surface border-b border-border-subtle">
              {[
                { key: "type" as SortKey, label: "Issue Type" },
                { key: "account" as SortKey, label: "Account" },
                { key: "count" as SortKey, label: "Count" },
                { key: "dollarExposure" as SortKey, label: "Dollar Exposure" },
                { key: "totalManualFixMins" as SortKey, label: "Manual Fix Time" },
                { key: "severity" as SortKey, label: "Severity" },
              ].map(({ key, label }) => (
                <th
                  key={key}
                  className="text-left py-3 px-4 text-xs uppercase tracking-widest text-text-muted cursor-pointer"
                  onClick={() => toggleSort(key)}
                >
                  {label} <SortArrow col={key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedAnomalies.map((a, i) => {
              const rowKey = `${a.type}-${a.account}-${i}`;
              const isExpanded = expandedAnomalyKey === rowKey;
              return (
                <Fragment key={rowKey}>
                  <tr
                    key={rowKey}
                    className={`border-b border-border-subtle cursor-pointer hover:bg-quanto-teal-bg/50 ${isExpanded ? "bg-quanto-teal-bg/50" : ""}`}
                    onClick={() => setExpandedAnomalyKey(isExpanded ? null : rowKey)}
                  >
                    <td className="py-3 px-4">{ISSUE_TYPE_LABELS[a.type] ?? a.type}</td>
                    <td className="py-3 px-4">{a.account}</td>
                    <td className="py-3 px-4">{a.count}</td>
                    <td className="py-3 px-4">${a.dollarExposure.toLocaleString()}</td>
                    <td className="py-3 px-4">{formatHoursMins(a.totalManualFixMins)}</td>
                    <td className="py-3 px-4">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${severityClass(a.severity)}`}>
                        {a.severity}
                      </span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${rowKey}-expanded`}>
                      <td colSpan={6} className="p-0 bg-score-red-bg/30">
                        <div className="px-4 py-3 overflow-x-auto transition-all max-h-96">
                          {a.transactions.length === 0 ? (
                            <p className="text-text-muted text-sm">No transaction detail available.</p>
                          ) : (
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-border-subtle text-left text-xs uppercase text-text-muted">
                                  <th className="py-2 pr-4">Date</th>
                                  <th className="py-2 pr-4">Vendor</th>
                                  <th className="py-2 pr-4">Account</th>
                                  <th className="py-2 pr-4">Amount</th>
                                  <th className="py-2 pr-4">Type</th>
                                  <th className="py-2">Flag Reason</th>
                                </tr>
                              </thead>
                              <tbody>
                                {a.transactions.map((t, j) => (
                                  <tr key={j} className="border-b border-border-subtle/50">
                                    <td className="py-2 pr-4">{t.date.toLocaleDateString()}</td>
                                    <td className="py-2 pr-4">{t.name || "—"}</td>
                                    <td className="py-2 pr-4">{t.account}</td>
                                    <td className="py-2 pr-4">${Math.abs(t.amount).toLocaleString()}</td>
                                    <td className="py-2 pr-4">{t.transactionType}</td>
                                    <td className="py-2">{t.flagReason}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AccountHealthSection({
  result,
  sectionClass,
}: {
  result: ScorecardResult;
  sectionClass: string;
}) {
  return (
    <section
      id="account_health"
      className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
      style={{ animationDelay: "500ms" }}
    >
      <h2 className="text-lg font-semibold text-quanto-navy mb-4">Account Health</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {result.accounts.map((acc) => (
          <div
            key={acc.accountName}
            className="bg-card border border-border-subtle rounded-2xl p-5 shadow-sm relative group"
          >
            <div className="flex justify-between items-start">
              <h3 className="font-semibold text-quanto-navy">{acc.accountName}</h3>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  acc.status === "healthy"
                    ? "bg-score-green-bg text-score-green"
                    : acc.status === "warning"
                      ? "bg-score-amber-bg text-score-amber"
                      : "bg-score-red-bg text-score-red"
                }`}
              >
                {acc.status}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-sm text-text-muted">
              <span>Last reconciled: {acc.daysSinceLastReconciled} days ago</span>
              <span>Avg lag: {acc.avgLagDays} days</span>
              <span>
                Open issues:{" "}
                {acc.duplicatePairCount + acc.unreconciledCount + acc.miscategorizedCount}
              </span>
            </div>
            {acc.totalExposureAmount > 0 && (
              <p className="text-score-red text-sm font-medium mt-2">
                $ exposure: ${acc.totalExposureAmount.toLocaleString()}
              </p>
            )}
            <div className="absolute left-4 right-4 top-full mt-1 p-3 bg-quanto-navy text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              {acc.duplicatePairCount} duplicates · {acc.unreconciledCount} unreconciled ·{" "}
              {acc.miscategorizedCount} miscategorized
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CleanupSummary({
  result,
  viewMode,
  sectionClass,
}: {
  result: ScorecardResult;
  viewMode: "buyer" | "seller";
  sectionClass: string;
}) {
  const hoursManual = (result.cleanupCostEstimate / 150).toFixed(0);
  return (
    <section
      id="cleanup_summary"
      className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
      style={{ animationDelay: "600ms" }}
    >
      <h2 className="text-lg font-semibold text-quanto-navy mb-4">
        {viewMode === "buyer" ? "What You're Inheriting" : "Your Path to a Higher Valuation"}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs uppercase tracking-widest text-text-muted">Estimated Cleanup Cost</p>
          <p className="text-score-red text-3xl font-bold mt-1">
            ${result.cleanupCostEstimate.toLocaleString()}
          </p>
          <p className="text-sm text-text-muted mt-1">
            To bring books to acquisition-ready standard at $150/hr bookkeeper rate.
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest text-text-muted">Quanto Automates This In</p>
          <p className="text-score-green text-3xl font-bold mt-1">&lt; 1 business day</p>
          <p className="text-sm text-text-muted mt-1">
            vs {hoursManual} hours of manual bookkeeper time.
          </p>
        </div>
      </div>
      <hr className="border-border-subtle my-6" />
      <p className="text-sm text-text-muted italic">
        {viewMode === "buyer"
          ? "Books in this condition typically trade at a discount. Clean books command 0.3–0.6x higher revenue multiples."
          : "Every hour of cleanup you complete increases your exit valuation. Quanto gets you there faster."}
      </p>
    </section>
  );
}

function Footer({ sectionClass }: { sectionClass: string }) {
  return (
    <section
      id="footer"
      className={`${sectionClass} max-w-6xl mx-auto px-4 mt-16 pb-12 border-t border-border-subtle pt-8 text-center`}
      style={{ animationDelay: "700ms" }}
    >
      <a
        href="https://tryquanto.com"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block bg-quanto-teal text-white px-8 py-4 rounded-xl font-semibold text-lg hover:opacity-90 transition-opacity"
      >
        See how Quanto automates this →
      </a>
      <p className="text-xs text-text-muted mt-4">Backed by a16z SpeedRun · tryquanto.com</p>
      <p className="text-xs text-text-muted mt-1">Generated by Quanto Firm Health Scorecard</p>
    </section>
  );
}
