"use client";

import { useRef, useState, useEffect } from "react";
import Papa from "papaparse";
import {
  buildScorecard,
  parseTransactions,
} from "@/lib/scorecard";
import { SAMPLE_TRANSACTIONS, SAMPLE_FIRM_NAME } from "@/lib/sampleData";
import type { ScorecardResult, Anomaly } from "@/lib/types";

function formatHoursMins(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = Math.round(totalMins % 60);
  if (h === 0) return `${m} mins`;
  return `${h} hrs ${m} mins`;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "#2D9B5A"; // score-green
  if (score >= 40) return "#F4A261"; // score-amber
  return "#E63946"; // score-red
}

function getSeverityBadgeClass(severity: string): string {
  if (severity === "high") return "bg-score-red text-white";
  if (severity === "medium") return "bg-score-amber text-white";
  return "bg-gray-400 text-white";
}

type SortKey = "type" | "account" | "count" | "totalManualFixMins" | "severity";
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

export default function Home() {
  const [result, setResult] = useState<ScorecardResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [anomalySort, setAnomalySort] = useState<{
    key: SortKey;
    dir: "asc" | "desc";
  }>({ key: "severity", dir: "desc" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!result) return;
    const target = result.healthScore;
    const duration = 1000;
    const start = performance.now();
    let rafId: number;
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      setAnimatedScore(Math.round(target * t));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [result?.healthScore]);

  const handleFile = (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) return;
    setLoading(true);
    Papa.parse(file, {
      header: true,
      complete: (parsed) => {
        const rows = (parsed.data ?? []) as Record<string, string>[];
        const transactions = parseTransactions(rows);
        const scorecard = buildScorecard(transactions, file.name.replace(/\.csv$/i, "") || "Firm");
        setResult(scorecard);
        setLoading(false);
      },
      error: () => {
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
    setResult(buildScorecard(SAMPLE_TRANSACTIONS, SAMPLE_FIRM_NAME));
  };

  const sortedAnomalies: Anomaly[] = result
    ? [...result.anomalies].sort((a, b) => {
        const k = anomalySort.key;
        if (k === "severity") {
          const diff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
          return anomalySort.dir === "desc" ? -diff : diff;
        }
        if (k === "type" || k === "account") {
          const va = String(a[k]);
          const vb = String(b[k]);
          const cmp = va.localeCompare(vb);
          return anomalySort.dir === "desc" ? -cmp : cmp;
        }
        const va = a[k] as number;
        const vb = b[k] as number;
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

  const SortArrow = ({ col }: { col: SortKey }) =>
    anomalySort.key === col ? (
      <span className="ml-1">{anomalySort.dir === "desc" ? "↓" : "↑"}</span>
    ) : null;

  if (result === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-surface p-6">
        <div
          className={`w-full max-w-md rounded-xl border-2 border-dashed p-12 text-center transition-colors cursor-pointer
            ${dragOver ? "border-brand-teal bg-brand-teal-light" : "border-border-subtle bg-card"}
          `}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
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
              <div className="w-10 h-10 border-4 border-brand-teal border-t-transparent rounded-full animate-spin" />
              <p className="text-brand-navy font-medium">Processing…</p>
            </div>
          ) : (
            <p className="text-brand-navy">
              Drop a CSV here or click to upload
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={loadSample}
          disabled={loading}
          className="mt-6 px-6 py-3 rounded-lg bg-brand-teal text-white font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          Load Sample Firm
        </button>
      </div>
    );
  }

  const sectionClass = "opacity-0 animate-fade-in-up";

  return (
    <div className="min-h-screen bg-surface text-brand-navy">
      <section
        id="header"
        className={`${sectionClass} max-w-6xl mx-auto px-4 py-8 flex flex-wrap items-center justify-between gap-6`}
        style={{ animationDelay: "0ms" }}
      >
        <div>
          <h1 className="text-2xl font-bold text-brand-navy">{result.firmName}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {result.generatedAt.toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <svg width={120} height={120} className="flex-shrink-0">
            <circle
              cx={60}
              cy={60}
              r={52}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={10}
            />
            <circle
              cx={60}
              cy={60}
              r={52}
              fill="none"
              stroke={getScoreColor(animatedScore)}
              strokeWidth={10}
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 52}`}
              strokeDashoffset={
                2 * Math.PI * 52 * (1 - animatedScore / 100)
              }
              transform="rotate(-90 60 60)"
            />
            <text
              x={60}
              y={56}
              textAnchor="middle"
              className="text-2xl font-bold fill-brand-navy"
            >
              {animatedScore}
            </text>
            <text
              x={60}
              y={72}
              textAnchor="middle"
              className="text-sm fill-gray-500"
            >
              /100
            </text>
          </svg>
        </div>
      </section>

      <section
        id="stat_cards"
        className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
        style={{ animationDelay: "100ms" }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              field: "avgReconciliationLagDays" as const,
              label: "Avg Reconciliation Lag",
              unit: " days",
              warn: 7,
              critical: 14,
              value: result.avgReconciliationLagDays,
            },
            {
              field: "totalAnomalies" as const,
              label: "Total Anomalies",
              unit: "",
              warn: 10,
              critical: 20,
              value: result.totalAnomalies,
            },
            {
              field: "hoursLostPerMonth" as const,
              label: "Est. Hours Lost / Month",
              unit: " hrs",
              warn: 5,
              critical: 15,
              value: result.hoursLostPerMonth,
            },
          ].map(({ label, unit, warn, critical, value }) => {
            const color =
              value >= critical
                ? "text-score-red"
                : value >= warn
                  ? "text-score-amber"
                  : "text-brand-navy";
            return (
              <div
                key={label}
                className="bg-card border border-border-subtle rounded-xl p-6 shadow-sm"
              >
                <p className="text-[11px] uppercase tracking-widest text-gray-400">
                  {label}
                </p>
                <p className={`text-5xl font-bold ${color} mt-1`}>
                  {value}
                  {unit}
                </p>
              </div>
            );
          })}
          <div className="bg-card border border-border-subtle rounded-xl p-6 shadow-sm">
            <p className="text-[11px] uppercase tracking-widest text-gray-400">
              Projected Annual Savings
            </p>
            <p className="text-5xl font-bold text-brand-teal mt-1">
              ${result.projectedAnnualSavings.toLocaleString()}
            </p>
          </div>
        </div>
      </section>

      <section
        id="anomaly_table"
        className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
        style={{ animationDelay: "200ms" }}
      >
        <h2 className="text-lg font-semibold text-brand-navy mb-4">
          Anomaly Breakdown
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full bg-card border border-border-subtle rounded-xl overflow-hidden shadow-sm">
            <thead>
              <tr className="bg-surface border-b border-border-subtle">
                <th
                  className="text-left py-3 px-4 text-[11px] uppercase tracking-widest text-gray-500 cursor-pointer"
                  onClick={() => toggleSort("type")}
                >
                  Issue Type <SortArrow col="type" />
                </th>
                <th
                  className="text-left py-3 px-4 text-[11px] uppercase tracking-widest text-gray-500 cursor-pointer"
                  onClick={() => toggleSort("account")}
                >
                  Account <SortArrow col="account" />
                </th>
                <th
                  className="text-left py-3 px-4 text-[11px] uppercase tracking-widest text-gray-500 cursor-pointer"
                  onClick={() => toggleSort("count")}
                >
                  Count <SortArrow col="count" />
                </th>
                <th
                  className="text-left py-3 px-4 text-[11px] uppercase tracking-widest text-gray-500 cursor-pointer"
                  onClick={() => toggleSort("totalManualFixMins")}
                >
                  Manual Fix Time <SortArrow col="totalManualFixMins" />
                </th>
                <th
                  className="text-left py-3 px-4 text-[11px] uppercase tracking-widest text-gray-500 cursor-pointer"
                  onClick={() => toggleSort("severity")}
                >
                  Severity <SortArrow col="severity" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAnomalies.map((a, i) => (
                <tr
                  key={i}
                  className="border-b border-border-subtle last:border-0"
                >
                  <td className="py-3 px-4 capitalize">{a.type}</td>
                  <td className="py-3 px-4">{a.account}</td>
                  <td className="py-3 px-4">{a.count}</td>
                  <td className="py-3 px-4">
                    {formatHoursMins(a.totalManualFixMins)}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${getSeverityBadgeClass(a.severity)}`}
                    >
                      {a.severity}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section
        id="account_health_grid"
        className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
        style={{ animationDelay: "300ms" }}
      >
        <h2 className="text-lg font-semibold text-brand-navy mb-4">
          Account Health
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {result.accounts.map((acc) => (
            <AccountCard key={acc.accountName} account={acc} />
          ))}
        </div>
      </section>

      <section
        id="top_issue_callout"
        className={`${sectionClass} max-w-6xl mx-auto px-4 py-6`}
        style={{ animationDelay: "400ms" }}
      >
        <div className="border-l-4 border-brand-teal bg-brand-teal-light rounded-xl p-6">
          <p className="text-[11px] uppercase tracking-widest text-brand-teal font-medium">
            ⚡ Top Issue
          </p>
          <p className="text-lg font-medium text-brand-navy mt-2">
            {result.topIssue.plainEnglishDescription}
          </p>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <p className="text-sm text-gray-500">Manual fix time</p>
              <p className="text-score-red font-medium">
                {formatHoursMins(result.topIssue.totalManualFixMins)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Quanto fix time</p>
              <p className="text-score-green font-medium">
                {result.topIssue.quantoFixTime}
              </p>
            </div>
          </div>
          <p className="text-brand-teal font-semibold mt-3">
            Time saved: {formatHoursMins(result.topIssue.timeSavedMins)}
          </p>
        </div>
      </section>

      <section
        id="footer"
        className={`${sectionClass} max-w-6xl mx-auto px-4 mt-12 pb-8 text-center`}
        style={{ animationDelay: "500ms" }}
      >
        <a
          href="https://tryquanto.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-brand-teal text-white px-6 py-3 rounded-lg font-medium hover:opacity-90 transition"
        >
          See how Quanto automates this →
        </a>
        <p className="text-xs text-gray-400 mt-3">
          Generated by Quanto Firm Health Scorecard
        </p>
      </section>
    </div>
  );
}

function AccountCard({
  account,
}: {
  account: ScorecardResult["accounts"][0];
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const openCount =
    account.duplicatePairCount +
    account.unreconciledCount +
    account.miscategorizedCount;

  const statusClass =
    account.status === "healthy"
      ? "bg-score-green"
      : account.status === "warning"
        ? "bg-score-amber"
        : "bg-score-red";

  return (
    <div
      className="bg-card border border-border-subtle rounded-xl p-6 shadow-sm relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-semibold text-brand-navy">{account.accountName}</h3>
          <p className="text-sm text-gray-500 mt-1">
            {account.daysSinceLastReconciled} days since reconciled
          </p>
          <p className="text-sm text-gray-600 mt-1">
            {openCount} open issue{openCount !== 1 ? "s" : ""}
          </p>
        </div>
        <span
          className={`inline-block px-3 py-1 rounded-full text-white text-sm font-medium ${statusClass}`}
        >
          {account.status}
        </span>
      </div>
      {showTooltip && (
        <div className="absolute left-4 right-4 top-full mt-2 p-3 bg-brand-navy text-white text-sm rounded-lg shadow-lg z-10">
          Duplicates: {account.duplicatePairCount} · Unreconciled:{" "}
          {account.unreconciledCount} · Miscategorized:{" "}
          {account.miscategorizedCount}
        </div>
      )}
    </div>
  );
}
