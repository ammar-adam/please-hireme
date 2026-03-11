"use client";

import { useRef, useState, useEffect, useCallback, Fragment } from "react";
import Papa from "papaparse";
import { buildScorecard, parseTransactions } from "@/lib/scorecard";
import { ALL_SAMPLES, transactionsToCSV } from "@/lib/samples";
import type {
  ScorecardResult,
  Anomaly,
  AccountHealth,
  ScoreBreakdown,
  QBOTransaction,
  PanelContext,
  StatPayload,
  SampleDefinition,
  AnomalyType,
} from "@/lib/types";

// ── Helpers ────────────────────────────────────────────────────────

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

function getGradeColor(grade: string): string {
  if (grade === "A") return "#2D9B5A";
  if (grade === "B") return "#0A9396";
  if (grade === "C") return "#F4A261";
  return "#E63946";
}

const ISSUE_TYPE_LABELS: Record<AnomalyType, string> = {
  duplicate: "Duplicate Entries",
  unreconciled: "Unreconciled Items",
  miscategorized: "Miscategorized",
  ap_aging: "AP Aging (Unpaid Bills)",
  ar_aging: "AR Aging (Uncollected)",
  owner_dependency: "Owner Dependency",
  round_number: "Round Number Estimates",
  balance_jump: "Balance Jumps",
};

const QUANTO_FIX_DESCRIPTIONS: Record<string, string> = {
  duplicate: "Quanto automatically detects and flags duplicate entries before they hit your books.",
  unreconciled: "Quanto's reconciliation agent matches transactions to bank statements in real time.",
  miscategorized: "Quanto uses AI to categorize transactions based on vendor history and patterns.",
  ap_aging: "Quanto tracks payables and sends automated reminders before they become overdue.",
  ar_aging: "Quanto monitors receivables and escalates collection follow-ups automatically.",
  owner_dependency: "Quanto distributes transaction approval across team members to reduce key-man risk.",
  round_number: "Quanto flags round-number entries and prompts for invoice verification.",
  balance_jump: "Quanto detects unexplained balance changes and creates reconciliation tasks immediately.",
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
type SortKey = "type" | "account" | "count" | "dollarExposure" | "manualFixMins" | "severity";

// ── Main Component ─────────────────────────────────────────────────

export default function Home() {
  const [result, setResult] = useState<ScorecardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastTransactions, setLastTransactions] = useState<QBOTransaction[] | null>(null);
  const [lastFirmName, setLastFirmName] = useState<string | null>(null);
  const [currentMode, setCurrentMode] = useState<"buyer" | "seller">("buyer");
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelContext, setPanelContext] = useState<PanelContext | null>(null);
  const [previewSample, setPreviewSample] = useState<SampleDefinition | null>(null);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [modeFlash, setModeFlash] = useState(false);
  const [anomalySort, setAnomalySort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "severity", dir: "desc" });
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [dashboardMounted, setDashboardMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animated score counter
  useEffect(() => {
    if (!result) return;
    const scores = [result.dataQualityScore, result.acquisitionRiskScore, result.automationPotentialScore, result.marginExpansionScore];
    const target = Math.round(scores.reduce((a, b) => a + b, 0) / 4);
    const duration = 1200;
    const start = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);
    let rafId: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      setAnimatedScore(Math.round(target * easeOut(t)));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [result]);

  // Dashboard mount animation
  useEffect(() => {
    if (result) {
      setDashboardMounted(false);
      const t = setTimeout(() => setDashboardMounted(true), 50);
      return () => clearTimeout(t);
    }
  }, [result]);

  const openPanel = useCallback((ctx: PanelContext) => {
    setPanelContext(ctx);
    setPanelOpen(true);
  }, []);

  const filenameToFirmName = (filename: string): string => {
    const base = filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : "Firm";
  };

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
          const name = filenameToFirmName(file.name);
          const scorecard = buildScorecard(transactions, name, currentMode);
          setResult(scorecard);
          setLastTransactions(transactions);
          setLastFirmName(name);
          setAiNarrative(null);
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

  const loadSample = (sample: SampleDefinition) => {
    setParseError(null);
    setLoading(true);
    setTimeout(() => {
      const scorecard = buildScorecard(sample.transactions, sample.firmName, currentMode);
      setResult(scorecard);
      setLastTransactions(sample.transactions);
      setLastFirmName(sample.firmName);
      setAiNarrative(null);
      setLoading(false);
    }, 100);
  };

  const toggleMode = (newMode: "buyer" | "seller") => {
    if (newMode === currentMode) return;
    setCurrentMode(newMode);
    if (lastTransactions && lastFirmName) {
      const scorecard = buildScorecard(lastTransactions, lastFirmName, newMode);
      setResult(scorecard);
      setAiNarrative(null);
      setModeFlash(true);
      setTimeout(() => setModeFlash(false), 600);
    }
  };

  const generateNarrative = async () => {
    if (!result || aiLoading) return;
    setAiLoading(true);
    setAiNarrative("");
    try {
      const payload = {
        ...result,
        generatedAt: result.generatedAt.toISOString(),
      };
      const res = await fetch("/api/narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to generate narrative");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAiNarrative(text);
      }
    } catch {
      setAiNarrative("Failed to generate narrative. Please check your API key.");
    }
    setAiLoading(false);
  };

  const sortedAnomalies: Anomaly[] = result
    ? [...result.anomalies].sort((a, b) => {
        const k = anomalySort.key;
        if (k === "severity") {
          const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
          return anomalySort.dir === "desc" ? diff : -diff;
        }
        if (k === "type" || k === "account") {
          const cmp = String(a[k]).localeCompare(String(b[k]));
          return anomalySort.dir === "desc" ? -cmp : cmp;
        }
        const va = k === "dollarExposure" ? a.dollarExposure : k === "manualFixMins" ? a.manualFixMins : a.count;
        const vb = k === "dollarExposure" ? b.dollarExposure : k === "manualFixMins" ? b.manualFixMins : b.count;
        return anomalySort.dir === "desc" ? vb - va : va - vb;
      })
    : [];

  const toggleSort = (key: SortKey) => {
    setAnomalySort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));
  };

  // ── Upload Screen ──────────────────────────────────────────────

  if (!result) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-6">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-quanto-teal">Quanto</h1>
          <p className="text-quanto-navy text-sm tracking-widest uppercase mt-1">Firm Health Scorecard</p>
        </div>

        {/* Sample Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-4xl w-full mb-8">
          {ALL_SAMPLES.map((sample) => (
            <div key={sample.id} className="bg-card border border-border-subtle rounded-2xl p-5 shadow-sm flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-quanto-navy text-sm">{sample.firmName}</h3>
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: getGradeColor(sample.grade) }}
                >
                  {sample.grade}
                </span>
              </div>
              <p className="text-text-muted text-xs mb-4 flex-1">{sample.description}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewSample(sample)}
                  className="flex-1 px-3 py-2 text-xs font-medium border border-border-subtle rounded-lg text-quanto-navy hover:bg-surface transition"
                >
                  Preview CSV
                </button>
                <button
                  type="button"
                  onClick={() => loadSample(sample)}
                  disabled={loading}
                  className="flex-1 px-3 py-2 text-xs font-medium bg-quanto-teal text-white rounded-lg hover:opacity-90 transition disabled:opacity-50"
                >
                  Load &amp; Analyze
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Upload Zone */}
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
              <p className="text-quanto-navy font-medium">Processing...</p>
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
        {parseError && <p className="mt-3 text-score-red text-sm">{parseError}</p>}

        {/* Preview Modal */}
        {previewSample && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewSample(null)}>
            <div className="bg-card rounded-2xl shadow-xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-5 border-b border-border-subtle">
                <div>
                  <h3 className="font-semibold text-quanto-navy">{previewSample.firmName} — CSV Preview</h3>
                  <p className="text-text-muted text-xs mt-1">Showing 20 of {previewSample.transactions.length} rows</p>
                </div>
                <button type="button" onClick={() => setPreviewSample(null)} className="text-text-muted hover:text-quanto-navy text-xl">&times;</button>
              </div>
              <div className="overflow-auto flex-1 p-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-widest text-text-muted">
                      <th className="py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Num</th>
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3">Memo</th>
                      <th className="py-2 pr-3">Account</th>
                      <th className="py-2 pr-3">Split</th>
                      <th className="py-2 pr-3 text-right">Amount</th>
                      <th className="py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewSample.transactions.slice(0, 20).map((t) => (
                      <tr key={t.id} className="border-b border-border-subtle/50">
                        <td className="py-1.5 pr-3 whitespace-nowrap">{t.date.toLocaleDateString()}</td>
                        <td className="py-1.5 pr-3">{t.transactionType}</td>
                        <td className="py-1.5 pr-3">{t.num}</td>
                        <td className="py-1.5 pr-3">{t.name || "—"}</td>
                        <td className="py-1.5 pr-3 max-w-[120px] truncate">{t.memo || "—"}</td>
                        <td className="py-1.5 pr-3">{t.account}</td>
                        <td className="py-1.5 pr-3">{t.split}</td>
                        <td className="py-1.5 pr-3 text-right">${Math.abs(t.amount).toLocaleString()}</td>
                        <td className="py-1.5 text-right">{t.balance != null ? `$${t.balance.toLocaleString()}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Dashboard ──────────────────────────────────────────────────

  const avgLag = result.accounts.length > 0
    ? parseFloat((result.accounts.reduce((s, a) => s + a.avgLagDays, 0) / result.accounts.length).toFixed(1))
    : 0;
  const totalAnomalies = result.anomalies.reduce((s, a) => s + a.count, 0);

  const stagger = (i: number) => ({
    opacity: dashboardMounted ? 1 : 0,
    transform: dashboardMounted ? "translateY(0)" : "translateY(12px)",
    transition: `opacity 0.4s ease ${i * 100}ms, transform 0.4s ease ${i * 100}ms`,
  });

  const flashClass = modeFlash ? "animate-pulse ring-2 ring-quanto-teal/30" : "";

  return (
    <div className="min-h-screen bg-surface text-quanto-navy">
      {/* Header */}
      <section className="border-b border-border-subtle bg-card px-8 py-6 flex flex-wrap items-center justify-between gap-6" style={stagger(0)}>
        <div>
          <p className="text-quanto-teal font-bold text-sm">Quanto</p>
          <h1 className="text-2xl font-bold text-quanto-navy mt-1">{result.firmName}</h1>
          <p className="text-text-muted text-sm mt-1">
            Generated {result.generatedAt.toLocaleDateString()} · {currentMode === "buyer" ? "Acquisition Due Diligence" : "Firm Improvement Report"}
          </p>
        </div>
        <div className="flex items-center gap-5">
          {/* Mode Toggle */}
          <div className="flex rounded-full overflow-hidden border border-border-subtle bg-surface">
            <button
              type="button"
              onClick={() => toggleMode("buyer")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${currentMode === "buyer" ? "bg-quanto-navy text-white" : "text-quanto-navy hover:bg-quanto-teal-bg"}`}
            >
              Buyer View
            </button>
            <button
              type="button"
              onClick={() => toggleMode("seller")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${currentMode === "seller" ? "bg-quanto-navy text-white" : "text-quanto-navy hover:bg-quanto-teal-bg"}`}
            >
              Seller View
            </button>
          </div>
          {/* Overall Gauge */}
          <div className="flex flex-col items-center">
            <svg width={140} height={140} className="flex-shrink-0">
              <circle cx={70} cy={70} r={58} fill="none" stroke="#E2E8F0" strokeWidth={10} />
              <circle
                cx={70} cy={70} r={58} fill="none"
                stroke={getScoreColor(animatedScore)}
                strokeWidth={10} strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 58}
                strokeDashoffset={2 * Math.PI * 58 * (1 - animatedScore / 100)}
                transform="rotate(-90 70 70)"
                style={{ transition: "stroke-dashoffset 0.3s ease" }}
              />
              <text x={70} y={64} textAnchor="middle" className="text-2xl font-bold fill-quanto-navy">{animatedScore}</text>
              <text x={70} y={82} textAnchor="middle" className="text-sm fill-text-muted">/100</text>
            </svg>
            <span className="text-sm font-semibold mt-1" style={{ color: getGradeColor(result.overallGrade) }}>
              Grade: {result.overallGrade}
            </span>
          </div>
          {/* Back button */}
          <button type="button" onClick={() => { setResult(null); setAiNarrative(null); }} className="text-text-muted hover:text-quanto-navy text-sm underline">
            New Analysis
          </button>
        </div>
      </section>

      {/* Score Cards */}
      <section className="max-w-6xl mx-auto px-4 py-8" style={stagger(1)}>
        <h2 className="text-lg font-semibold text-quanto-navy mb-4">Score Breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Data Quality", score: result.dataQualityScore, idx: 0 },
            { label: currentMode === "seller" ? "Valuation Risk" : "Acquisition Risk", score: result.acquisitionRiskScore, idx: 1 },
            { label: "Automation Potential", score: result.automationPotentialScore, idx: 2 },
            { label: "Margin Expansion", score: result.marginExpansionScore, idx: 3 },
          ].map(({ label, score, idx }) => {
            const r = 36;
            const c = 2 * Math.PI * r;
            return (
              <div
                key={label}
                className={`bg-card border border-border-subtle rounded-2xl p-6 shadow-sm cursor-pointer hover:border-quanto-teal/40 transition-all ${flashClass}`}
                onClick={() => openPanel({ type: "score", payload: result.scoreBreakdowns[idx] })}
              >
                <p className="text-[11px] uppercase tracking-widest text-text-muted">{label}</p>
                <div className="flex items-center gap-4 mt-3">
                  <svg width={80} height={80} className="flex-shrink-0">
                    <circle cx={40} cy={40} r={r} fill="none" stroke="#E2E8F0" strokeWidth={6} />
                    <circle
                      cx={40} cy={40} r={r} fill="none"
                      stroke={getScoreColor(score)}
                      strokeWidth={6} strokeLinecap="round"
                      strokeDasharray={c}
                      strokeDashoffset={c * (1 - score / 100)}
                      transform="rotate(-90 40 40)"
                    />
                  </svg>
                  <span className="text-[48px] font-bold leading-none" style={{ color: getScoreColor(score) }}>{Math.round(score)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Stat Row */}
      <section className="max-w-6xl mx-auto px-4 py-6" style={stagger(2)}>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { name: "Avg Reconciliation Lag", value: `${avgLag} days`, raw: avgLag, explanation: `Average reconciliation lag across ${result.accounts.length} accounts is ${avgLag} days.` },
            { name: "Total Anomalies", value: String(totalAnomalies), raw: totalAnomalies, explanation: `${totalAnomalies} total anomalies detected across ${result.anomalies.length} issue groups.` },
            { name: "Hours Lost / Month", value: `${result.hoursLostPerMonth} hrs`, raw: result.hoursLostPerMonth, explanation: `Estimated ${result.hoursLostPerMonth} hours per month spent on manual fixes.` },
            { name: "Projected Annual Savings", value: `$${result.projectedAnnualSavings.toLocaleString()}`, raw: result.projectedAnnualSavings, explanation: `At $150/hr, eliminating ${result.hoursLostPerMonth} hrs/month saves $${result.projectedAnnualSavings.toLocaleString()}/year.` },
            { name: "Liability Exposure", value: `$${result.liabilityExposure.toLocaleString()}`, raw: result.liabilityExposure, explanation: `AP aging + AR aging totals $${result.liabilityExposure.toLocaleString()}.` },
            { name: "Cleanup Cost Estimate", value: `$${result.cleanupCostEstimate.toLocaleString()}`, raw: result.cleanupCostEstimate, explanation: `Total manual fix time: ${(result.cleanupCostEstimate / 150).toFixed(0)} hours at $150/hr.` },
          ].map((stat) => (
            <div
              key={stat.name}
              className={`bg-card border border-border-subtle rounded-2xl p-4 shadow-sm cursor-pointer hover:border-quanto-teal/40 transition ${flashClass}`}
              onClick={() => openPanel({
                type: "stat",
                payload: { name: stat.name, value: stat.value, explanation: stat.explanation, relatedAnomalies: result.anomalies } as StatPayload,
              })}
            >
              <p className="text-[11px] uppercase tracking-widest text-text-muted">{stat.name}</p>
              <p className="text-2xl font-bold mt-1 text-quanto-navy">{stat.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Anomaly Table */}
      <section className="max-w-6xl mx-auto px-4 py-6" style={stagger(3)}>
        <h2 className="text-lg font-semibold text-quanto-navy mb-1">Anomaly Breakdown</h2>
        <p className="text-sm text-text-muted mb-4">
          {currentMode === "buyer"
            ? "Every flagged item is a risk you inherit. Click any row for details."
            : "Every flagged item is suppressing your valuation. Click to see what needs fixing."}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full bg-card border border-border-subtle rounded-2xl overflow-hidden shadow-sm">
            <thead>
              <tr className="bg-surface border-b border-border-subtle">
                {[
                  { key: "type" as SortKey, label: "Issue Type" },
                  { key: "account" as SortKey, label: "Account" },
                  { key: "count" as SortKey, label: "Count" },
                  { key: "manualFixMins" as SortKey, label: "Manual Fix Time" },
                  { key: "dollarExposure" as SortKey, label: "Dollar Impact" },
                  { key: "severity" as SortKey, label: "Severity" },
                ].map(({ key, label }) => (
                  <th
                    key={key}
                    className="text-left py-3 px-4 text-[10px] uppercase tracking-widest text-text-muted cursor-pointer select-none"
                    onClick={() => toggleSort(key)}
                  >
                    {label}
                    {anomalySort.key === key && <span className="ml-1">{anomalySort.dir === "desc" ? "\u2193" : "\u2191"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedAnomalies.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-border-subtle cursor-pointer hover:bg-quanto-teal-bg/50 transition-colors"
                  onClick={() => openPanel({ type: "anomaly", payload: a })}
                >
                  <td className="py-3 px-4 text-sm">{ISSUE_TYPE_LABELS[a.type] ?? a.type}</td>
                  <td className="py-3 px-4 text-sm">{a.account}</td>
                  <td className="py-3 px-4 text-sm">{a.count}</td>
                  <td className="py-3 px-4 text-sm">{formatHoursMins(a.manualFixMins)}</td>
                  <td className="py-3 px-4 text-sm">{a.dollarExposure > 0 ? `$${a.dollarExposure.toLocaleString()}` : "—"}</td>
                  <td className="py-3 px-4">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                      a.severity === "high" ? "bg-score-red-bg text-score-red" :
                      a.severity === "medium" ? "bg-score-amber-bg text-score-amber" :
                      "bg-surface text-text-muted"
                    }`}>{a.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Account Health Grid */}
      <section className="max-w-6xl mx-auto px-4 py-6" style={stagger(4)}>
        <h2 className="text-lg font-semibold text-quanto-navy mb-4">Account Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {result.accounts.map((acc) => (
            <div
              key={acc.accountName}
              className="bg-card border border-border-subtle rounded-2xl p-5 shadow-sm cursor-pointer hover:border-quanto-teal/40 transition"
              onClick={() => openPanel({ type: "account", payload: acc })}
            >
              <div className="flex justify-between items-start">
                <h3 className="font-semibold text-quanto-navy text-sm">{acc.accountName}</h3>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  acc.status === "healthy" ? "bg-score-green-bg text-score-green" :
                  acc.status === "warning" ? "bg-score-amber-bg text-score-amber" :
                  "bg-score-red-bg text-score-red"
                }`}>{acc.status}</span>
              </div>
              <div className="mt-3 text-xs text-text-muted space-y-1">
                <p>Last activity: {acc.daysSinceLastTransaction} days ago</p>
                <p>Open issues: {acc.openIssues}</p>
                <p>Avg lag: {acc.avgLagDays} days</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Top Issue Callout */}
      <section className="max-w-6xl mx-auto px-4 py-6" style={stagger(5)}>
        <div className="border-l-4 border-quanto-teal bg-quanto-teal-bg rounded-2xl p-6">
          <div className="flex justify-between items-start">
            <p className="text-[11px] uppercase tracking-widest text-quanto-teal font-semibold">Top Priority Issue</p>
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              result.topIssue.severity === "high" ? "bg-score-red-bg text-score-red" :
              result.topIssue.severity === "medium" ? "bg-score-amber-bg text-score-amber" :
              "bg-surface text-text-muted"
            }`}>{result.topIssue.severity}</span>
          </div>
          <p className="text-lg font-medium text-quanto-navy mt-2">{result.topIssue.plainEnglishDescription}</p>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-sm text-text-muted">Manual Fix Time</p>
              <p className="text-score-red font-bold">{formatHoursMins(result.topIssue.manualFixMins)}</p>
            </div>
            <div>
              <p className="text-sm text-text-muted">With Quanto</p>
              <p className="text-score-green font-bold">{result.topIssue.quantoFixTime}</p>
            </div>
          </div>
          <p className="text-quanto-teal font-semibold mt-3">
            Time saved: {formatHoursMins(result.topIssue.timeSavedMins)} — estimated value: ${Math.round((result.topIssue.timeSavedMins / 60) * 150).toLocaleString()}
          </p>
        </div>
      </section>

      {/* AI Narrative */}
      <section className="max-w-6xl mx-auto px-4 py-6" style={stagger(6)}>
        <h2 className="text-lg font-semibold text-quanto-navy mb-4">AI Firm Diagnosis</h2>
        {!aiNarrative && !aiLoading && (
          <button
            type="button"
            onClick={generateNarrative}
            className="px-6 py-3 bg-quanto-navy text-white rounded-xl font-semibold hover:opacity-90 transition"
          >
            Generate Firm Diagnosis
          </button>
        )}
        {(aiNarrative || aiLoading) && (
          <div className="bg-card border border-border-subtle rounded-2xl p-8 shadow-sm">
            <div className="prose prose-sm max-w-none text-quanto-navy leading-relaxed whitespace-pre-wrap">
              {aiNarrative}
              {aiLoading && <span className="inline-block w-0.5 h-4 bg-quanto-teal ml-0.5 animate-pulse" />}
            </div>
          </div>
        )}
      </section>

      {/* Footer */}
      <section className="max-w-6xl mx-auto px-4 mt-16 pb-12 border-t border-border-subtle pt-8 text-center" style={stagger(7)}>
        <a
          href="https://tryquanto.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-quanto-teal text-white px-8 py-4 rounded-xl font-semibold text-lg hover:opacity-90 transition-opacity"
        >
          See how Quanto automates this &rarr;
        </a>
      </section>

      {/* Side Panel */}
      <SidePanel open={panelOpen} context={panelContext} onClose={() => setPanelOpen(false)} mode={currentMode} />
    </div>
  );
}

// ── Side Panel ─────────────────────────────────────────────────────

function SidePanel({
  open,
  context,
  onClose,
  mode,
}: {
  open: boolean;
  context: PanelContext | null;
  onClose: () => void;
  mode: "buyer" | "seller";
}) {
  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-[480px] bg-card z-50 shadow-xl transition-transform duration-200 ease-out overflow-y-auto ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-5 border-b border-border-subtle sticky top-0 bg-card z-10">
          <h3 className="font-semibold text-quanto-navy">
            {context?.type === "score" && (context.payload as ScoreBreakdown).category}
            {context?.type === "anomaly" && `${ISSUE_TYPE_LABELS[(context.payload as Anomaly).type]} — ${(context.payload as Anomaly).account}`}
            {context?.type === "account" && (context.payload as AccountHealth).accountName}
            {context?.type === "stat" && (context.payload as StatPayload).name}
          </h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-quanto-navy text-xl">&times;</button>
        </div>

        {context?.type === "score" && <ScorePanelContent breakdown={context.payload as ScoreBreakdown} />}
        {context?.type === "anomaly" && <AnomalyPanelContent anomaly={context.payload as Anomaly} />}
        {context?.type === "account" && <AccountPanelContent account={context.payload as AccountHealth} />}
        {context?.type === "stat" && <StatPanelContent stat={context.payload as StatPayload} />}
      </div>
    </>
  );
}

function ScorePanelContent({ breakdown }: { breakdown: ScoreBreakdown }) {
  const allTxns = breakdown.affectedAnomalies.flatMap((a) => a.affectedTransactions);
  return (
    <div className="p-5 space-y-6">
      <div>
        <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">What This Measures</h4>
        <p className="text-sm text-quanto-navy">This score evaluates the {breakdown.category.toLowerCase()} dimension of the firm's books.</p>
      </div>
      <div>
        <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">Exact Math</h4>
        <p className="text-sm text-quanto-navy leading-relaxed">{breakdown.explanation}</p>
      </div>
      {allTxns.length > 0 && (
        <div>
          <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">Affected Transactions</h4>
          <TransactionTable transactions={allTxns} />
        </div>
      )}
    </div>
  );
}

function AnomalyPanelContent({ anomaly }: { anomaly: Anomaly }) {
  return (
    <div className="p-5 space-y-6">
      <div>
        <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">Analysis</h4>
        <p className="text-sm text-quanto-navy leading-relaxed">{anomaly.mathExplanation}</p>
      </div>
      {anomaly.affectedTransactions.length > 0 && (
        <div>
          <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">Affected Transactions</h4>
          <TransactionTable transactions={anomaly.affectedTransactions} />
        </div>
      )}
      <div>
        <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">What Quanto Does</h4>
        <p className="text-sm text-quanto-teal">{QUANTO_FIX_DESCRIPTIONS[anomaly.type] ?? "Quanto automates detection and resolution of this issue."}</p>
      </div>
    </div>
  );
}

function AccountPanelContent({ account }: { account: AccountHealth }) {
  return (
    <div className="p-5 space-y-6">
      <div className="flex items-center gap-3">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          account.status === "healthy" ? "bg-score-green-bg text-score-green" :
          account.status === "warning" ? "bg-score-amber-bg text-score-amber" :
          "bg-score-red-bg text-score-red"
        }`}>{account.status}</span>
      </div>
      <div>
        <p className="text-sm text-quanto-navy leading-relaxed">
          This account {account.status === "critical" ? "needs immediate attention" : account.status === "warning" ? "shows moderate risk" : "is in good shape"}.
          Average reconciliation lag is {account.avgLagDays} days. Last activity was {account.daysSinceLastTransaction} days ago.
          There are {account.openIssues} open issues ({account.duplicateCount} duplicates, {account.unreconciledCount} unreconciled, {account.miscategorizedCount} miscategorized).
        </p>
      </div>
      {account.affectedTransactions.length > 0 && (
        <div>
          <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">Recent Transactions</h4>
          <TransactionTable transactions={account.affectedTransactions.slice(0, 20)} />
        </div>
      )}
    </div>
  );
}

function StatPanelContent({ stat }: { stat: StatPayload }) {
  return (
    <div className="p-5 space-y-6">
      <div>
        <p className="text-3xl font-bold text-quanto-navy">{stat.value}</p>
      </div>
      <div>
        <h4 className="text-[11px] uppercase tracking-widest text-text-muted mb-2">How This Was Calculated</h4>
        <p className="text-sm text-quanto-navy leading-relaxed">{stat.explanation}</p>
      </div>
    </div>
  );
}

function TransactionTable({ transactions }: { transactions: QBOTransaction[] }) {
  return (
    <div className="max-h-[300px] overflow-y-auto border border-border-subtle rounded-lg">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-widest text-text-muted">
            <th className="py-2 px-3">Date</th>
            <th className="py-2 px-3">Vendor</th>
            <th className="py-2 px-3">Account</th>
            <th className="py-2 px-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id} className="border-b border-border-subtle/50">
              <td className="py-1.5 px-3 whitespace-nowrap">{t.date.toLocaleDateString()}</td>
              <td className="py-1.5 px-3">{t.name || "—"}</td>
              <td className="py-1.5 px-3">{t.account}</td>
              <td className="py-1.5 px-3 text-right">${Math.abs(t.amount).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
