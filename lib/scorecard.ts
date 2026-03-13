import type {
  QBOTransaction,
  Anomaly,
  AccountHealth,
  TopIssue,
  ScoreBreakdown,
  ScorecardResult,
} from "./types";
import { buildValueProfile } from "./valueProfile";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Bookkeeping labor rate for cleanup cost and margin recovery ($/hr) */
const HOURLY_RATE = 45;

/** Known software/platform vendors to avoid flagging as owner dependency */
const PLATFORM_NAMES = new Set([
  "stripe", "shopify", "salesforce", "adobe", "aws", "google", "microsoft", "quickbooks",
  "xero", "bell canada", "rogers", "td bank", "rbc", "cibc", "scotiabank", "bmo", "wework",
  "uber", "uber eats", "fedex", "ups", "amazon",
]);

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

/** Returns at most 2 names with meaningful concentration risk: explicit owner/founder or very high share of tx. */
export function extractOwnerNames(transactions: QBOTransaction[]): string[] {
  const nameCounts = new Map<string, number>();
  for (const t of transactions) {
    const n = t.name.trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (PLATFORM_NAMES.has(key)) continue;
    nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
  }
  const total = transactions.length;
  const minCountExplicit = Math.max(6, Math.floor(total * 0.05)); // 5%+ with explicit keyword
  const minCountConcentration = Math.max(10, Math.floor(total * 0.10)); // 10%+ without keyword (single name)
  const suspiciousKeywords = /owner|founder|personal\s+draw|withdrawal|draw|salary|payroll/i;
  const overThreshold = [...nameCounts.entries()]
    .filter(([name, count]) => {
      const hasKeyword = suspiciousKeywords.test(name);
      if (hasKeyword && count >= minCountExplicit) return true;
      if (!hasKeyword && count >= minCountConcentration && name.split(/\s+/).length <= 4 && !/[0-9]/.test(name)) return true;
      return false;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);
  return overThreshold;
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
    const blankVendor = list.filter((t) => t.name.trim() === "");
    const uncat = list.filter((t) => t.account.toLowerCase().includes("uncategorized"));
    const noMemoLarge = list.filter((t) => t.memo.trim() === "" && Math.abs(t.amount) > 500);
    const reasonParts: string[] = [];
    if (blankVendor.length > 0) reasonParts.push(`blank vendor name (${blankVendor.length})`);
    if (uncat.length > 0) reasonParts.push(`uncategorized expense account (${uncat.length})`);
    if (noMemoLarge.length > 0) reasonParts.push(`no memo on amount > $500 (${noMemoLarge.length})`);
    const why = reasonParts.length > 0 ? ` Reason codes: ${reasonParts.join("; ")}.` : "";
    anomalies.push({
      id: nextAnomalyId("miscategorized"),
      type: "miscategorized",
      account,
      count: list.length,
      affectedTransactions: list,
      manualFixMins: list.length * 12,
      dollarExposure,
      severity: "low",
      mathExplanation: `${list.length} transactions on ${account} need review.${why} Consequence: inconsistent books and slower close. Quanto auto-categorizes from vendor history and flags exceptions.`,
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

/** Single summarized concentration anomaly: one per firm, not one per name. */
export function detectOwnerDependency(
  transactions: QBOTransaction[],
  ownerNames: string[]
): Anomaly[] {
  if (ownerNames.length === 0) return [];
  const allAffected: QBOTransaction[] = [];
  const namesSeen: string[] = [];
  for (const ownerName of ownerNames) {
    const affected = transactions.filter(
      (t) => t.name.trim().toLowerCase() === ownerName.trim().toLowerCase()
    );
    if (affected.length > 0) {
      allAffected.push(...affected);
      namesSeen.push(ownerName);
    }
  }
  if (allAffected.length === 0) return [];
  const totalCount = allAffected.length;
  const pct = ((totalCount / transactions.length) * 100).toFixed(0);
  const dollarExposure = allAffected.reduce((s, t) => s + Math.abs(t.amount), 0);
  const nameList = namesSeen.length <= 2 ? namesSeen.join(" and ") : `${namesSeen[0]} and ${namesSeen.length - 1} other(s)`;
  return [
    {
      id: nextAnomalyId("owner_dependency"),
      type: "owner_dependency",
      account: "All Accounts",
      count: totalCount,
      affectedTransactions: allAffected,
      manualFixMins: totalCount * 5,
      dollarExposure,
      severity: totalCount > 20 ? "high" : totalCount > 10 ? "medium" : "low",
      mathExplanation: `Key-person concentration: ${nameList} appears in ${pct}% of transactions (${totalCount} of ${transactions.length}). This signals dependency risk that can complicate acquisition or handoff.`,
    },
  ];
}

/** Flags credible suspicious round-number patterns: outflow only; exact $1000 multiples ≥$2000, or same amount ≥$2000 repeated 3+ times. */
export function detectRoundNumbers(transactions: QBOTransaction[]): Anomaly[] {
  const typeLower = (t: QBOTransaction) => t.transactionType.trim().toLowerCase();
  const isOutflow = (t: QBOTransaction) => {
    const type = typeLower(t);
    return type !== "deposit" && type !== "invoice" && type !== "payment";
  };
  const outflow = transactions.filter(isOutflow);
  const ROUND_MIN = 2000;
  const amountCounts = new Map<number, number>();
  for (const t of outflow) {
    const amt = Math.round(Math.abs(t.amount) * 100) / 100;
    if (amt < ROUND_MIN) continue;
    amountCounts.set(amt, (amountCounts.get(amt) ?? 0) + 1);
  }
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of outflow) {
    const amt = Math.abs(t.amount);
    const isRound1000 = amt >= ROUND_MIN && amt % 1000 === 0;
    const repeatCount = amountCounts.get(Math.round(amt * 100) / 100) ?? 0;
    const isRepeatedLarge = amt >= ROUND_MIN && repeatCount >= 3;
    if (!isRound1000 && !isRepeatedLarge) continue;
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
      affectedTransactions: [...list],
      manualFixMins: Math.min(list.length * 10, 60),
      dollarExposure: 0,
      severity: "low",
      mathExplanation: `${list.length} expense transactions on ${account} are unusually large round numbers (≥$2,000) or repeated identical amounts (${examples}). May be estimates without support; Quanto flags these for invoice verification.`,
    });
  }
  return anomalies;
}

/** Unexplained large balance movements; at most one per account, capped impact. */
export function detectBalanceJumps(transactions: QBOTransaction[]): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    if (t.balance == null) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  const JUMP_MIN = 15000; // only flag large, credible jumps
  for (const [account, list] of byAccount) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    const jumpTxns: QBOTransaction[] = [];
    let bestDiff = 0;
    let bestDetail = "";

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const diff = Math.abs(curr.balance! - prev.balance!);
      if (diff < JUMP_MIN) continue;

      const jumpDate = curr.date;
      const hasMatch = transactions.some((t) => {
        if (t.account !== account) return false;
        const withinRange = Math.abs(daysBetween(t.date, jumpDate)) <= 3;
        const matchesAmount = Math.abs(Math.abs(t.amount) - diff) < 0.01;
        return withinRange && matchesAmount;
      });

      if (!hasMatch && diff > bestDiff) {
        bestDiff = diff;
        bestDetail = `Balance jumped by ${fmt$(diff)} on ${fmtDate(curr.date)} with no matching transaction within 3 days`;
        jumpTxns.length = 0;
        jumpTxns.push(prev, curr);
      }
    }

    if (bestDetail) {
      const uniqueTxns = [...new Map(jumpTxns.map((t) => [t.id, t])).values()];
      anomalies.push({
        id: nextAnomalyId("balance_jump"),
        type: "balance_jump",
        account,
        count: 1,
        affectedTransactions: uniqueTxns.slice(0, 8),
        manualFixMins: Math.min(30, 60),
        dollarExposure: 0,
        severity: "medium",
        mathExplanation: `${account}: ${bestDetail}. Unexplained large movements may need reconciliation. Quanto detects these and creates reconciliation tasks.`,
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
// Single unified diagnostic; no buyer/seller mode. Grades: A 85+, B 70–84, C 55–69, D <55.

export function calculateScores(
  anomalies: Anomaly[],
  accounts: AccountHealth[],
  transactions: QBOTransaction[],
  hoursLostPerMonth: number,
  cleanupCostEstimate: number,
  dateRangeDays: number
): { scores: [number, number, number, number]; breakdowns: ScoreBreakdown[] } {
  const breakdowns: ScoreBreakdown[] = [];
  const SCORE_FLOOR = 10;
  const MAX_BOOK_QUALITY_DEDUCTION = 50;
  // Per-category caps so one detector doesn't dominate; account-normalized feel
  const CAP_DUPLICATE_PTS = 14;   // ~7 pairs
  const CAP_UNRECONCILED_PTS = 18;
  const CAP_MISCAT_PTS = 10;
  const CAP_ROUND_PTS = 5;

  // ── Book Quality (higher = better) ──
  let dupPts = 0, unrecPts = 0, miscPts = 0, roundPts = 0;
  const bqAnomalies: Anomaly[] = [];
  for (const a of anomalies) {
    if (a.type === "duplicate") { dupPts += 2 * a.count; bqAnomalies.push(a); }
    else if (a.type === "unreconciled") { unrecPts += a.count; bqAnomalies.push(a); }
    else if (a.type === "miscategorized") { miscPts += a.count; bqAnomalies.push(a); }
    else if (a.type === "round_number") { roundPts += a.count; bqAnomalies.push(a); }
  }
  dupPts = Math.min(dupPts, CAP_DUPLICATE_PTS);
  unrecPts = Math.min(unrecPts, CAP_UNRECONCILED_PTS);
  miscPts = Math.min(miscPts, CAP_MISCAT_PTS);
  roundPts = Math.min(roundPts, CAP_ROUND_PTS);
  const bqPenalty = Math.min(dupPts + unrecPts + miscPts + roundPts, MAX_BOOK_QUALITY_DEDUCTION);
  const dataQualityScore = Math.max(SCORE_FLOOR, Math.round(100 - bqPenalty));
  const bqParts: string[] = [];
  if (dupPts) bqParts.push(`duplicates (${dupPts} pts)`);
  if (unrecPts) bqParts.push(`unreconciled (${unrecPts} pts)`);
  if (miscPts) bqParts.push(`miscategorized (${miscPts} pts)`);
  if (roundPts) bqParts.push(`round numbers (${roundPts} pts)`);
  breakdowns.push({
    category: "Book Quality",
    rawScore: 100,
    penalty: bqPenalty,
    explanation: `Cleanliness and consistency of the books. Deductions: duplicate pairs -2 each (cap ${CAP_DUPLICATE_PTS}), unreconciled -1 (cap ${CAP_UNRECONCILED_PTS}), miscategorized -1 (cap ${CAP_MISCAT_PTS}), round numbers -1 (cap ${CAP_ROUND_PTS}). ${bqParts.length > 0 ? bqParts.join("; ") + "." : "No penalties — books are clean."}`,
    affectedAnomalies: bqAnomalies,
  });

  // ── Operational Risk (higher = lower risk, better) ──
  let opPenalty = 0;
  const opParts: string[] = [];
  const opAnomalies: Anomaly[] = [];
  for (const a of anomalies) {
    let pts = 0;
    if (a.type === "ap_aging") pts = Math.min(28, 2 * Math.floor(a.dollarExposure / 5000));
    else if (a.type === "ar_aging") pts = Math.min(28, 2 * Math.floor(a.dollarExposure / 5000));
    else if (a.type === "owner_dependency") pts = Math.min(10, 4 + Math.floor(a.count / 4)); // cap 10
    else if (a.type === "balance_jump") pts = 4;
    if (pts > 0) {
      opPenalty += pts;
      opAnomalies.push(a);
      opParts.push(`${a.type.replace("_", " ")}`);
    }
  }
  const criticalAccounts = accounts.filter((acc) => acc.status === "critical");
  const criticalPenalty = Math.min(12, criticalAccounts.length * 4); // cap 12
  if (criticalPenalty > 0) {
    opPenalty += criticalPenalty;
    opParts.push(`critical accounts (${criticalAccounts.length})`);
  }
  const acquisitionRiskScore = Math.max(SCORE_FLOOR, Math.round(100 - opPenalty));
  breakdowns.push({
    category: "Operational Risk",
    rawScore: 100,
    penalty: opPenalty,
    explanation: `Hidden bookkeeping and operational issues that create acquisition or cleanup risk. Higher score = lower risk. ${opParts.length > 0 ? "Deductions: " + opParts.join("; ") + "." : "No material risk signals."}`,
    affectedAnomalies: opAnomalies,
  });

  // ── Automation Fit (valuable even for clean firms: standardization, capacity, repeatability) ──
  let autoBase = 50;
  const autoParts: string[] = ["Base 50. Bonuses for automatable workload:"];
  const apAnomalies: Anomaly[] = [];
  const dupCount = anomalies.filter((a) => a.type === "duplicate").reduce((s, a) => s + a.count, 0);
  const unrecCount = anomalies.filter((a) => a.type === "unreconciled").reduce((s, a) => s + a.count, 0);
  const miscCount = anomalies.filter((a) => a.type === "miscategorized").reduce((s, a) => s + a.count, 0);
  const roundCount = anomalies.filter((a) => a.type === "round_number").reduce((s, a) => s + a.count, 0);
  if (dupCount >= 1) { autoBase += Math.min(15, dupCount * 2); autoParts.push(`duplicates (${dupCount})`); apAnomalies.push(...anomalies.filter((a) => a.type === "duplicate")); }
  if (unrecCount >= 1) { autoBase += Math.min(15, unrecCount * 1.5); autoParts.push(`unreconciled (${unrecCount})`); apAnomalies.push(...anomalies.filter((a) => a.type === "unreconciled")); }
  if (miscCount >= 1) { autoBase += Math.min(10, miscCount * 1.5); autoParts.push(`miscategorized (${miscCount})`); apAnomalies.push(...anomalies.filter((a) => a.type === "miscategorized")); }
  if (roundCount >= 1) { autoBase += Math.min(8, roundCount * 2); autoParts.push(`round numbers (${roundCount})`); apAnomalies.push(...anomalies.filter((a) => a.type === "round_number")); }
  let automationPotentialScore = Math.min(100, Math.round(autoBase));
  // Clean firms still get value: floor so A is reachable
  if (dataQualityScore >= 80 && acquisitionRiskScore >= 80) {
    automationPotentialScore = Math.max(automationPotentialScore, 75);
    autoParts.push("(floor 75 for clean firms: standardization, faster closes)");
  }
  breakdowns.push({
    category: "Automation Fit",
    rawScore: 50,
    penalty: -(automationPotentialScore - 50),
    explanation: `How much of the firm's bookkeeping maps to Quanto's automation. ${autoParts.join("; ")}. Final: ${automationPotentialScore}. Clean firms benefit from standardization and faster closes.`,
    affectedAnomalies: apAnomalies,
  });

  // ── Scale Readiness (composite) ──
  const scaleReadinessScore = Math.max(
    SCORE_FLOOR,
    Math.round((dataQualityScore * 0.35 + acquisitionRiskScore * 0.35 + automationPotentialScore * 0.3))
  );
  breakdowns.push({
    category: "Scale Readiness",
    rawScore: 100,
    penalty: 100 - scaleReadinessScore,
    explanation: `Readiness for scaling, repeatable onboarding, and roll-up integration. Formula: 35% Book Quality + 35% Operational Risk + 30% Automation Fit.`,
    affectedAnomalies: [],
  });

  return {
    scores: [dataQualityScore, acquisitionRiskScore, automationPotentialScore, scaleReadinessScore],
    breakdowns,
  };
}

export function calculateOverallGrade(
  dq: number, ar: number, ap: number, scale: number
): "A" | "B" | "C" | "D" {
  const avg = (dq + ar + ap + scale) / 4;
  if (avg >= 85) return "A";
  if (avg >= 70) return "B";
  if (avg >= 55) return "C";
  return "D";
}

// ── Build Scorecard ────────────────────────────────────────────────

export function buildScorecard(
  transactions: QBOTransaction[],
  firmName: string
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

  // Cleanup cost at bookkeeping rate
  const cleanupCostEstimate = Math.round((totalManualFixMins / 60) * HOURLY_RATE);

  // Projected annual margin recovery
  const projectedAnnualSavings = Math.round(hoursLostPerMonth * 12 * HOURLY_RATE);

  // Hidden financial exposure: duplicate $ + AP + AR
  const duplicateDollars = allAnomalies.filter((a) => a.type === "duplicate").reduce((s, a) => s + a.dollarExposure, 0);
  const hiddenFinancialExposure = duplicateDollars + apTotal + arTotal;

  // Scores (unified diagnostic)
  const { scores, breakdowns } = calculateScores(
    allAnomalies,
    accounts,
    transactions,
    hoursLostPerMonth,
    cleanupCostEstimate,
    dateRangeDays
  );
  const [dataQualityScore, acquisitionRiskScore, automationPotentialScore, scaleReadinessScore] = scores;
  const overallGrade = calculateOverallGrade(
    dataQualityScore, acquisitionRiskScore, automationPotentialScore, scaleReadinessScore
  );
  const valueProfile = buildValueProfile(overallGrade);

  // Top operational risk: weighted by dollar impact, severity, and manual time
  const severityWeight = { high: 3, medium: 2, low: 1 };
  const topAnomaly = allAnomalies.length === 0
    ? null
    : [...allAnomalies]
        .map((a) => ({
          a,
          score: (a.dollarExposure / 10000) * 0.4 + severityWeight[a.severity] * 10 * 0.3 + (a.manualFixMins / 60) * 2 * 0.3,
        }))
        .sort((x, y) => y.score - x.score)[0]?.a ?? null;

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

  const estimatedAnnualTimeRecoveryHours = parseFloat((hoursLostPerMonth * 12).toFixed(1));

  return {
    firmName,
    generatedAt,
    dataQualityScore,
    acquisitionRiskScore,
    automationPotentialScore,
    scaleReadinessScore,
    overallGrade,
    scoreBreakdowns: breakdowns,
    accounts,
    anomalies: allAnomalies,
    topIssue,
    valueProfile,
    liabilityExposure,
    cleanupCostEstimate,
    hoursLostPerMonth,
    estimatedAnnualTimeRecoveryHours,
    projectedAnnualSavings,
    hiddenFinancialExposure,
    aiNarrative: null,
    dateRangeDays,
  };
}

function buildTopIssueDescription(a: Anomaly): string {
  const hours = (a.manualFixMins / 60).toFixed(1);
  const accountsPhrase = a.account === "All Accounts" ? "across accounts" : `across ${a.account}`;
  switch (a.type) {
    case "unreconciled":
      return `${a.count} unreconciled transactions ${accountsPhrase} are creating ${hours} hours of manual review and delaying close quality. Quanto can automate first-pass review and exception routing.`;
    case "duplicate":
      return `${a.count} duplicate pair(s) ${accountsPhrase} — ${hours} hours to resolve manually. Quanto flags duplicates before they hit the books.`;
    case "miscategorized":
      return `${a.count} miscategorized or uncategorized items ${accountsPhrase} (${hours} hrs to fix). Quanto auto-categorizes from vendor history and flags exceptions.`;
    case "ap_aging":
      return `$${a.dollarExposure.toLocaleString()} in unpaid bills (AP aging) — ${a.count} items. Quanto tracks payables and automates reminders before they become overdue.`;
    case "ar_aging":
      return `$${a.dollarExposure.toLocaleString()} in uncollected invoices (AR aging) — ${a.count} items. Quanto monitors receivables and escalates collection follow-ups.`;
    case "owner_dependency":
      return `Key-person concentration: ${a.count} transactions tied to one or a few names. Increases handoff and acquisition risk. Quanto helps distribute approval and codify workflows.`;
    case "round_number":
      return `${a.count} round-number or repeated-amount expenses ${accountsPhrase} — may be estimates. Quanto flags these for invoice verification.`;
    case "balance_jump":
      return `Unexplained balance movement(s) on ${a.account} — ${hours} hrs to investigate. Quanto detects large unexplained changes and creates reconciliation tasks.`;
    default:
      return `${a.count} flagged items ${accountsPhrase}. Estimated ${hours} hours manual fix. Quanto can automate first-pass review.`;
  }
}
