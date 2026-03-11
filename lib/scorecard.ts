import type {
  QBOTransaction,
  Anomaly,
  AccountHealth,
  TopIssue,
  ScoreBreakdown,
  ScorecardResult,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(d1: Date, d2: Date): number {
  const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function fmt$(n: number): string {
  return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

let _idCounter = 0;
function nextAnomalyId(type: string): string {
  return `anomaly-${type}-${++_idCounter}`;
}

// ── Parse ──────────────────────────────────────────────────────────

export function parseTransactions(
  rows: Record<string, string>[]
): QBOTransaction[] {
  const result: QBOTransaction[] = [];
  const ts = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dateStr = row["Date"] ?? "";
    const date = new Date(dateStr);
    const amountStr = (row["Amount"] ?? "").replace(/,/g, "").replace(/\$/g, "");
    const amount = parseFloat(amountStr);
    const balanceStr = (row["Balance"] ?? "").trim().replace(/,/g, "").replace(/\$/g, "");
    const balanceParsed = balanceStr === "" ? NaN : parseFloat(balanceStr);
    const balance: number | null = Number.isNaN(balanceParsed) ? null : balanceParsed;

    if (isNaN(date.getTime()) || Number.isNaN(amount)) continue;

    result.push({
      id: `tx-${i}-${ts}`,
      date,
      transactionType: (row["Transaction Type"] ?? "").trim(),
      num: (row["Num"] ?? "").trim(),
      name: (row["Name"] ?? "").trim(),
      memo: (row["Memo/Description"] ?? "").trim(),
      account: (row["Account"] ?? "").trim(),
      split: (row["Split"] ?? "").trim(),
      amount,
      balance,
    });
  }
  return result;
}

// ── Owner Name Extraction ──────────────────────────────────────────

export function extractOwnerNames(transactions: QBOTransaction[]): string[] {
  const nameCounts = new Map<string, number>();
  for (const t of transactions) {
    const n = t.name.trim();
    if (!n) continue;
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }
  const threshold = transactions.length * 0.08;
  const owners: string[] = [];
  for (const [name, count] of nameCounts) {
    if (count >= threshold) owners.push(name);
  }
  return owners;
}

// ── Detectors ──────────────────────────────────────────────────────

export function detectDuplicates(transactions: QBOTransaction[]): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of byAccount) {
    const used = new Set<number>();
    const pairs: [QBOTransaction, QBOTransaction][] = [];
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (used.has(j)) continue;
        const a = list[i], b = list[j];
        if (
          a.amount === b.amount &&
          a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
          Math.abs(daysBetween(a.date, b.date)) <= 7
        ) {
          pairs.push([a, b]);
          used.add(i);
          used.add(j);
          break;
        }
      }
    }
    if (pairs.length === 0) continue;
    const affected = pairs.flatMap(([a, b]) => [a, b]);
    const dollarExposure = affected.reduce((s, t) => s + Math.abs(t.amount), 0);
    const vendorExamples = pairs.slice(0, 3).map(
      ([a]) => `${a.name} for ${fmt$(a.amount)}`
    ).join(", ");
    anomalies.push({
      id: nextAnomalyId("duplicate"),
      type: "duplicate",
      account,
      count: pairs.length,
      affectedTransactions: affected,
      manualFixMins: pairs.length * 25,
      dollarExposure,
      severity: "high",
      mathExplanation: `We found ${pairs.length} duplicate pair${pairs.length > 1 ? "s" : ""} on ${account}: ${vendorExamples}. Each pair has identical vendor, amount, and falls within 7 days. Each duplicate takes ~25 minutes to resolve manually.`,
    });
  }
  return anomalies;
}

export function detectUnreconciled(
  transactions: QBOTransaction[],
  referenceDate: Date
): Anomaly[] {
  const cutoff = new Date(referenceDate);
  cutoff.setDate(cutoff.getDate() - 30);

  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const balanceNullOrZero = t.balance == null || t.balance === 0;
    const olderThan30 = t.date < cutoff;
    const typeLower = t.transactionType.trim().toLowerCase();
    const notDepositOrPayment = typeLower !== "deposit" && typeLower !== "payment";
    if (balanceNullOrZero && olderThan30 && notDepositOrPayment) {
      const key = t.account || "(blank)";
      if (!byAccount.has(key)) byAccount.set(key, []);
      byAccount.get(key)!.push(t);
    }
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of byAccount) {
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    anomalies.push({
      id: nextAnomalyId("unreconciled"),
      type: "unreconciled",
      account,
      count: list.length,
      affectedTransactions: list,
      manualFixMins: list.length * 18,
      dollarExposure,
      severity: "medium",
      mathExplanation: `${list.length} transactions on ${account} are older than 30 days with no confirmed balance. Total exposure: ${fmt$(dollarExposure)}. Each item takes ~18 minutes to reconcile manually.`,
    });
  }
  return anomalies;
}

export function detectMiscategorized(transactions: QBOTransaction[]): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const blankName = t.name.trim() === "";
    const uncategorized = t.account.toLowerCase().includes("uncategorized");
    const blankMemoBig = t.memo.trim() === "" && Math.abs(t.amount) > 500;
    if (!blankName && !uncategorized && !blankMemoBig) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of byAccount) {
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const blankCount = list.filter((t) => t.name.trim() === "").length;
    const uncatCount = list.filter((t) => t.account.toLowerCase().includes("uncategorized")).length;
    const parts: string[] = [];
    if (blankCount > 0) parts.push(`${blankCount} with blank vendor name`);
    if (uncatCount > 0) parts.push(`${uncatCount} in Uncategorized Expense`);
    anomalies.push({
      id: nextAnomalyId("miscategorized"),
      type: "miscategorized",
      account,
      count: list.length,
      affectedTransactions: list,
      manualFixMins: list.length * 12,
      dollarExposure,
      severity: "low",
      mathExplanation: `${list.length} miscategorized transactions on ${account}: ${parts.join(", ")}. Total exposure: ${fmt$(dollarExposure)}. Each takes ~12 minutes to review and recategorize.`,
    });
  }
  return anomalies;
}

export function detectAPAging(
  transactions: QBOTransaction[],
  referenceDate: Date
): Anomaly[] {
  const sixtyDaysAgo = new Date(referenceDate);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const apItems: QBOTransaction[] = [];
  for (const t of transactions) {
    const isBillOrExpense =
      t.transactionType.trim().toLowerCase() === "bill" ||
      t.transactionType.trim().toLowerCase() === "expense";
    const isPayable = t.account.toLowerCase().includes("payable");
    if (!isBillOrExpense && !isPayable) continue;
    if (t.date >= sixtyDaysAgo) continue;
    if (t.balance != null && t.balance !== 0) continue;
    apItems.push(t);
  }

  if (apItems.length === 0) return [];
  const dollarExposure = apItems.reduce((s, t) => s + Math.abs(t.amount), 0);
  const severity: "high" | "medium" = dollarExposure > 10000 ? "high" : "medium";
  const oldest = apItems.reduce((a, b) => (a.date < b.date ? a : b));
  return [
    {
      id: nextAnomalyId("ap_aging"),
      type: "ap_aging",
      account: "Accounts Payable",
      count: apItems.length,
      affectedTransactions: apItems,
      manualFixMins: apItems.length * 20,
      dollarExposure,
      severity,
      mathExplanation: `${apItems.length} bills unpaid for more than 60 days totalling ${fmt$(dollarExposure)}. Oldest from ${fmtDate(oldest.date)}. ${severity === "high" ? "This is a significant inherited liability." : "Moderate liability risk."}`,
    },
  ];
}

export function detectARAging(
  transactions: QBOTransaction[],
  referenceDate: Date
): Anomaly[] {
  const ninetyDaysAgo = new Date(referenceDate);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const arItems: QBOTransaction[] = [];
  for (const t of transactions) {
    if (t.transactionType.trim().toLowerCase() !== "invoice") continue;
    const isReceivable = t.account.toLowerCase().includes("receivable");
    if (!isReceivable) continue;
    if (t.date >= ninetyDaysAgo) continue;
    if (t.balance != null && t.balance !== 0) continue;
    arItems.push(t);
  }

  if (arItems.length === 0) return [];
  const dollarExposure = arItems.reduce((s, t) => s + Math.abs(t.amount), 0);
  const over120 = arItems.filter(
    (t) => daysBetween(t.date, referenceDate) > 120
  );
  const oldest = arItems.reduce((a, b) => (a.date < b.date ? a : b));
  return [
    {
      id: nextAnomalyId("ar_aging"),
      type: "ar_aging",
      account: "Accounts Receivable",
      count: arItems.length,
      affectedTransactions: arItems,
      manualFixMins: arItems.length * 15,
      dollarExposure,
      severity: "high",
      mathExplanation: `${arItems.length} invoices uncollected for more than 90 days totalling ${fmt$(dollarExposure)}. ${over120.length > 0 ? `${over120.length} are over 120 days and likely uncollectable.` : ""} Oldest outstanding since ${fmtDate(oldest.date)}.`,
    },
  ];
}

export function detectOwnerDependency(
  transactions: QBOTransaction[],
  ownerNames: string[]
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  for (const ownerName of ownerNames) {
    const affected = transactions.filter(
      (t) => t.name.trim().toLowerCase() === ownerName.trim().toLowerCase()
    );
    if (affected.length === 0) continue;
    const pct = ((affected.length / transactions.length) * 100).toFixed(0);
    anomalies.push({
      id: nextAnomalyId("owner_dependency"),
      type: "owner_dependency",
      account: "All Accounts",
      count: affected.length,
      affectedTransactions: affected,
      manualFixMins: affected.length * 5,
      dollarExposure: affected.reduce((s, t) => s + Math.abs(t.amount), 0),
      severity: "high",
      mathExplanation: `${ownerName} appears in ${pct}% of all transactions (${affected.length} of ${transactions.length}). This signals key-man dependency that increases acquisition risk.`,
    });
  }
  return anomalies;
}

export function detectRoundNumbers(transactions: QBOTransaction[]): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const amt = Math.abs(t.amount);
    if (amt < 1000 || amt % 500 !== 0) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of byAccount) {
    const examples = list.slice(0, 3).map((t) => `${t.name || "Unknown"} ${fmt$(t.amount)}`).join(", ");
    anomalies.push({
      id: nextAnomalyId("round_number"),
      type: "round_number",
      account,
      count: list.length,
      affectedTransactions: list,
      manualFixMins: list.length * 10,
      dollarExposure: 0,
      severity: "low",
      mathExplanation: `${list.length} transactions on ${account} are exact multiples of $500 over $1,000 (${examples}). These may be manual estimates rather than actual invoiced amounts.`,
    });
  }
  return anomalies;
}

export function detectBalanceJumps(transactions: QBOTransaction[]): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    if (t.balance == null) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of byAccount) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const jumpTxns: QBOTransaction[] = [];
    const jumpDetails: string[] = [];

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const diff = Math.abs(curr.balance! - prev.balance!);
      if (diff < 5000) continue;

      // Check if any single transaction within 2 days accounts for the change
      const jumpDate = curr.date;
      const hasMatch = transactions.some((t) => {
        if (t.account !== account) return false;
        const withinRange = Math.abs(daysBetween(t.date, jumpDate)) <= 2;
        const matchesAmount = Math.abs(Math.abs(t.amount) - diff) < 0.01;
        return withinRange && matchesAmount;
      });

      if (!hasMatch) {
        jumpTxns.push(prev, curr);
        jumpDetails.push(
          `Balance jumped by ${fmt$(diff)} on ${fmtDate(curr.date)} with no matching transaction within 2 days`
        );
      }
    }

    if (jumpTxns.length > 0) {
      anomalies.push({
        id: nextAnomalyId("balance_jump"),
        type: "balance_jump",
        account,
        count: jumpDetails.length,
        affectedTransactions: jumpTxns,
        manualFixMins: jumpDetails.length * 30,
        dollarExposure: 0,
        severity: "medium",
        mathExplanation: `${account}: ${jumpDetails[0]}${jumpDetails.length > 1 ? ` (and ${jumpDetails.length - 1} more)` : ""}.`,
      });
    }
  }
  return anomalies;
}

// ── Reconciliation Lag ─────────────────────────────────────────────

export function calculateReconciliationLag(
  transactions: QBOTransaction[],
  anomalies: Anomaly[],
  referenceDate: Date
): AccountHealth[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const SKIP = ["uncategorized", "expense", "income", "revenue"];
  const result: AccountHealth[] = [];
  for (const [accountName, list] of byAccount) {
    const lower = accountName.toLowerCase();
    if (SKIP.some((s) => lower.includes(s)) || list.length < 2) continue;

    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const lags: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = daysBetween(sorted[i - 1].date, sorted[i].date);
      const sameBalance = sorted[i - 1].balance === sorted[i].balance;
      if (sameBalance && gap > 5) lags.push(gap);
    }
    const avgLagDays = lags.length > 0
      ? parseFloat((lags.reduce((a, b) => a + b, 0) / lags.length).toFixed(1))
      : 0;

    let status: "healthy" | "warning" | "critical" = "healthy";
    if (avgLagDays > 14) status = "critical";
    else if (avgLagDays >= 7) status = "warning";

    const latest = sorted[sorted.length - 1].date;
    const daysSinceLastTransaction = daysBetween(latest, referenceDate);

    // Count per-account anomalies
    let dupCount = 0, unrecCount = 0, miscCount = 0;
    for (const a of anomalies) {
      if (a.account !== accountName) continue;
      if (a.type === "duplicate") dupCount += a.count;
      if (a.type === "unreconciled") unrecCount += a.count;
      if (a.type === "miscategorized") miscCount += a.count;
    }

    result.push({
      accountName,
      avgLagDays,
      unreconciledCount: unrecCount,
      duplicateCount: dupCount,
      miscategorizedCount: miscCount,
      status,
      daysSinceLastTransaction,
      openIssues: dupCount + unrecCount + miscCount,
      affectedTransactions: list,
    });
  }
  return result;
}

// ── Score Calculation ──────────────────────────────────────────────

export function calculateScores(
  anomalies: Anomaly[],
  accounts: AccountHealth[],
  transactions: QBOTransaction[],
  hoursLostPerMonth: number,
  mode: "buyer" | "seller"
): { scores: [number, number, number, number]; breakdowns: ScoreBreakdown[] } {
  const breakdowns: ScoreBreakdown[] = [];

  // ── Data Quality ──
  let dqRaw = 100;
  let dqPenalty = 0;
  const dqParts: string[] = [];
  const dqAnomalies: Anomaly[] = [];
  for (const a of anomalies) {
    let pts = 0;
    if (a.type === "duplicate") pts = 3 * a.count;
    else if (a.type === "unreconciled") pts = 2 * a.count;
    else if (a.type === "miscategorized") pts = 1.5 * a.count;
    else if (a.type === "round_number") pts = 2 * a.count;
    if (pts > 0) {
      dqPenalty += pts;
      dqAnomalies.push(a);
      dqParts.push(
        `Deducted ${pts} points for ${a.count} ${a.type.replace("_", " ")} issue${a.count > 1 ? "s" : ""} (${a.type === "duplicate" ? "3" : a.type === "unreconciled" ? "2" : a.type === "miscategorized" ? "1.5" : "2"}pts each)`
      );
    }
  }
  const dataQualityScore = Math.max(0, Math.round(dqRaw - dqPenalty));
  breakdowns.push({
    category: "Data Quality",
    rawScore: dqRaw,
    penalty: Math.round(dqPenalty),
    explanation: `Score started at ${dqRaw}. ${dqParts.length > 0 ? dqParts.join(". ") + "." : "No penalties applied — books are clean."}`,
    affectedAnomalies: dqAnomalies,
  });

  // ── Acquisition Risk ──
  let arRaw = 100;
  let arPenalty = 0;
  const arParts: string[] = [];
  const arAnomalies: Anomaly[] = [];
  for (const a of anomalies) {
    let pts = 0;
    if (a.type === "ap_aging") pts = 8 * Math.floor(a.dollarExposure / 5000);
    else if (a.type === "ar_aging") pts = 6 * Math.floor(a.dollarExposure / 5000);
    else if (a.type === "owner_dependency") pts = 10;
    else if (a.type === "balance_jump") pts = 5;
    if (pts > 0) {
      arPenalty += pts;
      arAnomalies.push(a);
      arParts.push(`Deducted ${pts} points for ${a.type.replace("_", " ")}`);
    }
  }
  for (const acc of accounts) {
    if (acc.status === "critical") {
      arPenalty += 3;
      arParts.push(`Deducted 3 points for critical account: ${acc.accountName}`);
    }
  }
  const acquisitionRiskScore = Math.max(0, Math.round(arRaw - arPenalty));
  breakdowns.push({
    category: mode === "seller" ? "Valuation Risk" : "Acquisition Risk",
    rawScore: arRaw,
    penalty: Math.round(arPenalty),
    explanation: `Score started at ${arRaw}. ${arParts.length > 0 ? arParts.join(". ") + "." : "No risk penalties — low acquisition risk."}`,
    affectedAnomalies: arAnomalies,
  });

  // ── Automation Potential ──
  let apRaw = 40;
  let apBonus = 0;
  const apParts: string[] = ["Base score: 40."];
  const apAnomalies: Anomaly[] = [];
  const dupCount = anomalies.filter((a) => a.type === "duplicate").reduce((s, a) => s + a.count, 0);
  const unrecCount = anomalies.filter((a) => a.type === "unreconciled").reduce((s, a) => s + a.count, 0);
  const miscCount = anomalies.filter((a) => a.type === "miscategorized").reduce((s, a) => s + a.count, 0);
  const roundCount = anomalies.filter((a) => a.type === "round_number").reduce((s, a) => s + a.count, 0);
  if (dupCount > 5) { apBonus += 10; apParts.push(`+10 for ${dupCount} duplicates (>5)`); apAnomalies.push(...anomalies.filter((a) => a.type === "duplicate")); }
  if (unrecCount > 10) { apBonus += 10; apParts.push(`+10 for ${unrecCount} unreconciled (>10)`); apAnomalies.push(...anomalies.filter((a) => a.type === "unreconciled")); }
  if (miscCount > 8) { apBonus += 10; apParts.push(`+10 for ${miscCount} miscategorized (>8)`); apAnomalies.push(...anomalies.filter((a) => a.type === "miscategorized")); }
  if (roundCount > 5) { apBonus += 10; apParts.push(`+10 for ${roundCount} round numbers (>5)`); apAnomalies.push(...anomalies.filter((a) => a.type === "round_number")); }
  const automationPotentialScore = Math.min(100, apRaw + apBonus);
  breakdowns.push({
    category: "Automation Potential",
    rawScore: apRaw,
    penalty: -apBonus,
    explanation: apParts.join(" ") + ` Final: ${automationPotentialScore}.`,
    affectedAnomalies: apAnomalies,
  });

  // ── Margin Expansion ──
  let marginExpansionScore: number;
  const meParts: string[] = [];
  if (mode === "seller") {
    const totalIncome = transactions
      .filter((t) => t.transactionType.trim().toLowerCase() === "deposit" || t.transactionType.trim().toLowerCase() === "invoice")
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    if (totalIncome > 0) {
      const annualCost = hoursLostPerMonth * 150 * 12;
      const annualIncome = totalIncome * (12 / Math.max(1, transactions.length / 15));
      marginExpansionScore = Math.min(100, Math.round((annualCost / annualIncome) * 100));
    } else {
      marginExpansionScore = 30;
    }
    meParts.push(`Based on hours lost relative to income. Score: ${marginExpansionScore}.`);
  } else {
    if (hoursLostPerMonth > 20) marginExpansionScore = 90;
    else if (hoursLostPerMonth >= 10) marginExpansionScore = 70;
    else if (hoursLostPerMonth >= 5) marginExpansionScore = 50;
    else marginExpansionScore = 30;
    meParts.push(`Hours lost/month: ${hoursLostPerMonth.toFixed(1)}. Score: ${marginExpansionScore}.`);
  }
  breakdowns.push({
    category: "Margin Expansion",
    rawScore: 100,
    penalty: 100 - marginExpansionScore,
    explanation: meParts.join(" "),
    affectedAnomalies: [],
  });

  return {
    scores: [dataQualityScore, acquisitionRiskScore, automationPotentialScore, marginExpansionScore],
    breakdowns,
  };
}

export function calculateOverallGrade(
  dq: number, ar: number, ap: number, me: number
): "A" | "B" | "C" | "D" {
  const avg = (dq + ar + ap + me) / 4;
  if (avg >= 85) return "A";
  if (avg >= 70) return "B";
  if (avg >= 55) return "C";
  return "D";
}

// ── Build Scorecard ────────────────────────────────────────────────

export function buildScorecard(
  transactions: QBOTransaction[],
  firmName: string,
  mode: "buyer" | "seller" = "buyer"
): ScorecardResult {
  _idCounter = 0;
  const generatedAt = new Date();
  const dates = transactions.map((t) => t.date.getTime());
  const minT = dates.length ? Math.min(...dates) : generatedAt.getTime();
  const maxT = dates.length ? Math.max(...dates) : generatedAt.getTime();
  const datasetEnd = new Date(maxT);
  const dateRangeDays = Math.max(1, daysBetween(new Date(minT), new Date(maxT)));

  // Run all detectors
  const ownerNames = extractOwnerNames(transactions);
  const duplicates = detectDuplicates(transactions);
  const unreconciled = detectUnreconciled(transactions, datasetEnd);
  const miscategorized = detectMiscategorized(transactions);
  const apAging = detectAPAging(transactions, datasetEnd);
  const arAging = detectARAging(transactions, datasetEnd);
  const ownerDep = detectOwnerDependency(transactions, ownerNames);
  const roundNumbers = detectRoundNumbers(transactions);
  const balanceJumps = detectBalanceJumps(transactions);

  const allAnomalies = [
    ...duplicates, ...unreconciled, ...miscategorized,
    ...apAging, ...arAging, ...ownerDep,
    ...roundNumbers, ...balanceJumps,
  ];

  const accounts = calculateReconciliationLag(transactions, allAnomalies, datasetEnd);

  // Hours lost
  const totalManualFixMins = allAnomalies.reduce((s, a) => s + a.manualFixMins, 0);
  const hoursLostPerMonth = parseFloat(((totalManualFixMins / 60) * (30 / dateRangeDays)).toFixed(1));

  // Liability exposure
  const apTotal = apAging.reduce((s, a) => s + a.dollarExposure, 0);
  const arTotal = arAging.reduce((s, a) => s + a.dollarExposure, 0);
  const liabilityExposure = apTotal + arTotal;

  // Cleanup cost
  const cleanupCostEstimate = Math.round((totalManualFixMins / 60) * 150);

  // Projected annual savings
  const projectedAnnualSavings = Math.round(hoursLostPerMonth * 12 * 150);

  // Scores
  const { scores, breakdowns } = calculateScores(
    allAnomalies, accounts, transactions, hoursLostPerMonth, mode
  );
  const [dataQualityScore, acquisitionRiskScore, automationPotentialScore, marginExpansionScore] = scores;
  const overallGrade = calculateOverallGrade(
    dataQualityScore, acquisitionRiskScore, automationPotentialScore, marginExpansionScore
  );

  // Top issue — highest dollar impact
  const topAnomaly = allAnomalies.length === 0
    ? null
    : [...allAnomalies].sort((a, b) => b.dollarExposure - a.dollarExposure || b.manualFixMins - a.manualFixMins)[0];

  const topIssue: TopIssue = topAnomaly
    ? {
        ...topAnomaly,
        plainEnglishDescription: buildTopIssueDescription(topAnomaly),
        quantoFixTime: "< 3 minutes",
        timeSavedMins: Math.max(0, topAnomaly.manualFixMins - 3),
      }
    : {
        id: "none",
        type: "duplicate",
        account: "—",
        count: 0,
        affectedTransactions: [],
        manualFixMins: 0,
        dollarExposure: 0,
        severity: "low",
        mathExplanation: "No issues detected.",
        plainEnglishDescription: "No issues detected — your books are clean.",
        quantoFixTime: "< 3 minutes",
        timeSavedMins: 0,
      };

  return {
    firmName,
    generatedAt,
    mode,
    dataQualityScore,
    acquisitionRiskScore,
    automationPotentialScore,
    marginExpansionScore,
    overallGrade,
    scoreBreakdowns: breakdowns,
    accounts,
    anomalies: allAnomalies,
    topIssue,
    liabilityExposure,
    cleanupCostEstimate,
    hoursLostPerMonth,
    projectedAnnualSavings,
    aiNarrative: null,
  };
}

function buildTopIssueDescription(a: Anomaly): string {
  const TYPE_LABELS: Record<string, string> = {
    duplicate: "duplicate entries",
    unreconciled: "unreconciled items",
    miscategorized: "miscategorized transactions",
    ap_aging: "unpaid bills",
    ar_aging: "uncollected invoices",
    owner_dependency: "owner-linked transactions",
    round_number: "round-number estimates",
    balance_jump: "unexplained balance jumps",
  };
  const label = TYPE_LABELS[a.type] ?? a.type;
  const hours = (a.manualFixMins / 60).toFixed(1);
  const vendor = a.affectedTransactions.length > 0 ? a.affectedTransactions[0].name || "unknown vendor" : "";
  const vendorPart = vendor && a.type === "duplicate" ? ` from ${vendor}` : "";
  return `Your ${a.account} account has ${a.count} ${label}${vendorPart} — estimated ${hours} hours to fix manually.`;
}
