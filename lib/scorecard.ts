import type {
  QBOTransaction,
  Anomaly,
  AnomalyTransaction,
  AccountHealth,
  TopIssue,
  FirmScores,
  ScorecardResult,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(d1: Date, d2: Date): number {
  const a = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const b = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function isInvalidDate(d: Date): boolean {
  return isNaN(d.getTime());
}

function formatDateForFlag(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Map raw CSV rows to QBOTransaction. Used as the first step in scorecard pipeline.
 * Accounting rationale: QuickBooks exports use specific column names; we normalize
 * and validate so downstream logic never sees malformed data.
 */
export function parseTransactions(
  rows: Record<string, string>[]
): QBOTransaction[] {
  const result: QBOTransaction[] = [];
  for (const row of rows) {
    const dateStr = row["Date"] ?? "";
    const date = new Date(dateStr);
    const amountStr = (row["Amount"] ?? "").replace(/,/g, "").replace(/\$/g, "");
    const amount = parseFloat(amountStr);
    const balanceStr = (row["Balance"] ?? "").trim().replace(/,/g, "").replace(/\$/g, "");
    const balanceParsed = balanceStr === "" ? NaN : parseFloat(balanceStr);
    const balance: number | null = Number.isNaN(balanceParsed)
      ? null
      : balanceParsed;

    if (isInvalidDate(date) || Number.isNaN(amount)) continue;

    result.push({
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

/**
 * Duplicate entries inflate expenses and distort P&L. In an acquisition, undetected
 * duplicates mean the acquirer overpays based on artificially high apparent costs.
 */
export function detectDuplicates(
  transactions: QBOTransaction[],
  _referenceDate: Date
): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of Array.from(byAccount.entries())) {
    const used = new Set<number>();
    const pairedIndices: number[][] = [];
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (used.has(j)) continue;
        const a = list[i];
        const b = list[j];
        const amountMatch = a.amount === b.amount;
        const nameMatch =
          a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
        const daysDiff = Math.abs(daysBetween(a.date, b.date));
        if (amountMatch && nameMatch && daysDiff <= 7) {
          pairedIndices.push([i, j]);
          used.add(i);
          used.add(j);
          break;
        }
      }
    }
    if (pairedIndices.length > 0) {
      const allTxnsInPairs: QBOTransaction[] = [];
      const anomalyTxns: AnomalyTransaction[] = [];
      let dollarExposure = 0;
      for (const [i, j] of pairedIndices) {
        const a = list[i];
        const b = list[j];
        allTxnsInPairs.push(a, b);
        dollarExposure += Math.abs(a.amount) + Math.abs(b.amount);
        const reasonA = `Possible duplicate of ${formatDateForFlag(b.date)} ${b.name} $${Math.abs(b.amount).toFixed(2)}`;
        const reasonB = `Possible duplicate of ${formatDateForFlag(a.date)} ${a.name} $${Math.abs(a.amount).toFixed(2)}`;
        anomalyTxns.push({
          date: a.date,
          name: a.name,
          memo: a.memo,
          account: a.account,
          amount: a.amount,
          transactionType: a.transactionType,
          flagReason: reasonA,
        });
        anomalyTxns.push({
          date: b.date,
          name: b.name,
          memo: b.memo,
          account: b.account,
          amount: b.amount,
          transactionType: b.transactionType,
          flagReason: reasonB,
        });
      }
      anomalies.push({
        type: "duplicate",
        account,
        count: pairedIndices.length,
        totalManualFixMins: pairedIndices.length * 25,
        dollarExposure,
        severity: "high",
        transactions: anomalyTxns,
      });
    }
  }
  return anomalies;
}

/**
 * Unreconciled items mean the books don't match the bank. An acquirer cannot trust
 * any balance sheet figure until these are resolved.
 */
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
    const notDeposit =
      t.transactionType.trim().toLowerCase() !== "deposit";
    if (balanceNullOrZero && olderThan30 && notDeposit) {
      const key = t.account || "(blank)";
      if (!byAccount.has(key)) byAccount.set(key, []);
      byAccount.get(key)!.push(t);
    }
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of Array.from(byAccount.entries())) {
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const anomalyTxns: AnomalyTransaction[] = list.map((t) => ({
      date: t.date,
      name: t.name,
      memo: t.memo,
      account: t.account,
      amount: t.amount,
      transactionType: t.transactionType,
      flagReason: `Unreconciled for ${daysBetween(t.date, referenceDate)} days — balance not confirmed`,
    }));
    anomalies.push({
      type: "unreconciled",
      account,
      count: list.length,
      totalManualFixMins: list.length * 18,
      dollarExposure,
      severity: "medium",
      transactions: anomalyTxns,
    });
  }
  return anomalies;
}

/**
 * Uncategorized transactions make expense reporting unreliable. Acquirers cannot
 * model future costs from chaotic books.
 */
export function detectMiscategorized(
  transactions: QBOTransaction[],
  _referenceDate: Date
): Anomaly[] {
  const byAccount = new Map<string, { t: QBOTransaction; reason: string }[]>();
  for (const t of transactions) {
    const blankName = t.name.trim() === "";
    const uncategorized = t.account.toLowerCase().includes("uncategorized");
    const blankMemoBigAmount = t.memo.trim() === "" && Math.abs(t.amount) > 500;
    let reason = "";
    if (blankName) reason = "Vendor name is blank";
    else if (uncategorized) reason = "Account contains 'uncategorized'";
    else if (blankMemoBigAmount) reason = "Memo blank and amount > $500 — needs review";
    if (!reason) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push({ t, reason });
  }

  const anomalies: Anomaly[] = [];
  for (const [account, items] of Array.from(byAccount.entries())) {
    const list = items.map(({ t }) => t);
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const anomalyTxns: AnomalyTransaction[] = items.map(({ t, reason }) => ({
      date: t.date,
      name: t.name,
      memo: t.memo,
      account: t.account,
      amount: t.amount,
      transactionType: t.transactionType,
      flagReason: reason,
    }));
    anomalies.push({
      type: "miscategorized",
      account,
      count: list.length,
      totalManualFixMins: list.length * 12,
      dollarExposure,
      severity: "low",
      transactions: anomalyTxns,
    });
  }
  return anomalies;
}

/**
 * Unpaid bills are liabilities an acquirer inherits. AP older than 60 days
 * signals cash flow problems or disorganized payables.
 */
export function detectAPAging(
  transactions: QBOTransaction[],
  referenceDate: Date
): Anomaly[] {
  const sixtyDaysAgo = new Date(referenceDate);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    if (t.transactionType.trim() !== "Bill") continue;
    if (!t.account.toLowerCase().includes("payable")) continue;
    if (t.date >= sixtyDaysAgo) continue;
    if (t.balance != null && t.balance !== 0) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of Array.from(byAccount.entries())) {
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const daysOld = list.map((t) => daysBetween(t.date, referenceDate));
    const severity = daysOld.some((d) => d > 60) ? "high" : "medium";
    const anomalyTxns: AnomalyTransaction[] = list.map((t, i) => ({
      date: t.date,
      name: t.name,
      memo: t.memo,
      account: t.account,
      amount: t.amount,
      transactionType: t.transactionType,
      flagReason: `Unpaid bill aged ${daysOld[i]} days — potential inherited liability`,
    }));
    anomalies.push({
      type: "ap_aging",
      account,
      count: list.length,
      totalManualFixMins: list.length * 20,
      dollarExposure,
      severity,
      transactions: anomalyTxns,
    });
  }
  return anomalies;
}

/**
 * Invoices uncollected >90 days are likely uncollectable. Overstated AR inflates
 * apparent revenue quality for an acquisition target.
 */
export function detectARAging(
  transactions: QBOTransaction[],
  referenceDate: Date
): Anomaly[] {
  const ninetyDaysAgo = new Date(referenceDate);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    if (t.transactionType.trim() !== "Invoice") continue;
    if (!t.account.toLowerCase().includes("receivable")) continue;
    if (t.date >= ninetyDaysAgo) continue;
    if (t.balance != null && t.balance !== 0) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of Array.from(byAccount.entries())) {
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const anomalyTxns: AnomalyTransaction[] = list.map((t) => ({
      date: t.date,
      name: t.name,
      memo: t.memo,
      account: t.account,
      amount: t.amount,
      transactionType: t.transactionType,
      flagReason: `Invoice uncollected for ${daysBetween(t.date, referenceDate)} days — likely uncollectable`,
    }));
    anomalies.push({
      type: "ar_aging",
      account,
      count: list.length,
      totalManualFixMins: list.length * 15,
      dollarExposure,
      severity: "high",
      transactions: anomalyTxns,
    });
  }
  return anomalies;
}

/**
 * Round number amounts ($500, $1000, etc.) signal manual estimates rather than
 * real invoices. In due diligence this raises questions about data integrity.
 */
export function detectRoundNumbers(
  transactions: QBOTransaction[],
  _referenceDate: Date
): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const amt = Math.abs(t.amount);
    if (amt % 100 !== 0 || amt < 500) continue;
    const type = t.transactionType.trim().toLowerCase();
    if (type === "deposit" || type === "journal entry") continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of Array.from(byAccount.entries())) {
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const anomalyTxns: AnomalyTransaction[] = list.map((t) => ({
      date: t.date,
      name: t.name,
      memo: t.memo,
      account: t.account,
      amount: t.amount,
      transactionType: t.transactionType,
      flagReason:
        "Round number amount may indicate manual estimate — verify source document",
    }));
    anomalies.push({
      type: "round_number",
      account,
      count: list.length,
      totalManualFixMins: list.length * 10,
      dollarExposure,
      severity: "low",
      transactions: anomalyTxns,
    });
  }
  return anomalies;
}

/**
 * Transactions with no name AND no memo are completely unauditable. An acquirer
 * has no way to verify what these represent.
 */
export function detectGhostTransactions(
  transactions: QBOTransaction[],
  _referenceDate: Date
): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    if (t.name.trim() !== "" || t.memo.trim() !== "") continue;
    if (Math.abs(t.amount) === 0) continue;
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of Array.from(byAccount.entries())) {
    const dollarExposure = list.reduce((s, t) => s + Math.abs(t.amount), 0);
    const anomalyTxns: AnomalyTransaction[] = list.map((t) => ({
      date: t.date,
      name: t.name,
      memo: t.memo,
      account: t.account,
      amount: t.amount,
      transactionType: t.transactionType,
      flagReason: "No vendor name or description — transaction is unauditable",
    }));
    anomalies.push({
      type: "ghost_transaction",
      account,
      count: list.length,
      totalManualFixMins: list.length * 20,
      dollarExposure,
      severity: "high",
      transactions: anomalyTxns,
    });
  }
  return anomalies;
}

function getAnomalyCountsAndExposureForAccount(
  accountName: string,
  anomalies: Anomaly[]
): {
  duplicatePairCount: number;
  unreconciledCount: number;
  miscategorizedCount: number;
  totalExposureAmount: number;
} {
  let duplicatePairCount = 0;
  let unreconciledCount = 0;
  let miscategorizedCount = 0;
  let totalExposureAmount = 0;
  for (const a of anomalies) {
    if (a.account !== accountName) continue;
    if (a.type === "duplicate") duplicatePairCount = a.count;
    if (a.type === "unreconciled") unreconciledCount = a.count;
    if (a.type === "miscategorized") miscategorizedCount = a.count;
    totalExposureAmount += a.dollarExposure;
  }
  return {
    duplicatePairCount,
    unreconciledCount,
    miscategorizedCount,
    totalExposureAmount,
  };
}

/**
 * Reconciliation lag indicates how stale the books are. Long gaps between
 * balance changes suggest the firm isn't reconciling regularly — a red flag for acquirers.
 */
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

  const result: AccountHealth[] = [];
  for (const [accountName, list] of Array.from(byAccount.entries())) {
    const sorted = [...list].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    const lagDurations: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const sameBalance = prev.balance === curr.balance;
      const gapDays = daysBetween(prev.date, curr.date);
      if (sameBalance && gapDays > 5) lagDurations.push(gapDays);
    }
    const avgLagDays =
      lagDurations.length === 0
        ? 0
        : lagDurations.reduce((s, d) => s + d, 0) / lagDurations.length;

    let status: "healthy" | "warning" | "critical" = "healthy";
    if (avgLagDays > 14) status = "critical";
    else if (avgLagDays >= 7) status = "warning";

    const latestDate =
      sorted.length > 0 ? sorted[sorted.length - 1].date : new Date(0);
    const daysSinceLastReconciled = daysBetween(latestDate, referenceDate);

    const counts = getAnomalyCountsAndExposureForAccount(accountName, anomalies);

    result.push({
      accountName,
      avgLagDays,
      daysSinceLastReconciled,
      duplicatePairCount: counts.duplicatePairCount,
      unreconciledCount: counts.unreconciledCount,
      miscategorizedCount: counts.miscategorizedCount,
      totalExposureAmount: counts.totalExposureAmount,
      status,
    });
  }
  return result;
}

/**
 * Composite scores for data quality, acquisition risk, automation potential,
 * and margin expansion — the four dimensions that matter in firm acquisition due diligence.
 */
export function calculateScores(
  anomalies: Anomaly[],
  accounts: AccountHealth[],
  transactions: QBOTransaction[],
  hoursLostPerMonth: number,
  dateRangeDays: number
): FirmScores {
  // Data Quality (start 100)
  let dataQuality = 100;
  for (const a of anomalies) {
    if (a.type === "duplicate") dataQuality -= 3 * a.count;
    else if (a.type === "unreconciled") dataQuality -= 2 * a.count;
    else if (a.type === "ghost_transaction") dataQuality -= 2 * a.count;
    else if (a.type === "miscategorized") dataQuality -= 1.5 * a.count;
    else if (a.type === "round_number") dataQuality -= 1 * a.count;
  }
  for (const acc of accounts) {
    if (acc.status === "warning") dataQuality -= 5;
    if (acc.status === "critical") dataQuality -= 10;
  }
  dataQuality = Math.max(0, Math.round(dataQuality));

  // Acquisition Risk (start 0, higher = worse, cap 100)
  let acquisitionRiskRaw = 0;
  for (const a of anomalies) {
    if (a.type === "ap_aging") acquisitionRiskRaw += 5 * a.count;
    else if (a.type === "ar_aging") acquisitionRiskRaw += 8 * a.count;
    else if (a.type === "duplicate") acquisitionRiskRaw += 3 * a.count;
    else if (a.type === "ghost_transaction") acquisitionRiskRaw += 2 * a.count;
  }
  acquisitionRiskRaw = Math.min(100, acquisitionRiskRaw);

  // Automation Potential
  let automationPotential = 40;
  const totalTxns = transactions.length;
  if (totalTxns > 0) {
    const deposits = transactions.filter(
      (t) => t.transactionType.trim().toLowerCase() === "deposit"
    ).length;
    if (deposits / totalTxns > 0.3) automationPotential += 20;
    const journalEntries = transactions.filter(
      (t) => t.transactionType.trim().toLowerCase() === "journal entry"
    ).length;
    if (journalEntries / totalTxns < 0.05) automationPotential += 20;
    const expenses = transactions.filter(
      (t) =>
        t.transactionType.trim().toLowerCase() !== "deposit" &&
        t.transactionType.trim().toLowerCase() !== "invoice"
    );
    const vendorCounts = new Map<string, number>();
    for (const t of expenses) {
      const name = t.name.trim() || "(blank)";
      vendorCounts.set(name, (vendorCounts.get(name) ?? 0) + Math.abs(t.amount));
    }
    const sorted = [...vendorCounts.entries()].sort((a, b) => b[1] - a[1]);
    const top5Sum = sorted.slice(0, 5).reduce((s, [, v]) => s + v, 0);
    const totalExpense = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
    if (totalExpense > 0 && top5Sum / totalExpense > 0.5) automationPotential += 20;
  }
  automationPotential = Math.min(100, automationPotential);

  // Margin Expansion
  const annualCost = hoursLostPerMonth * 12 * 150;
  const safeDays = dateRangeDays <= 0 ? 1 : dateRangeDays;
  const totalDeposits = transactions
    .filter((t) => t.transactionType.trim().toLowerCase() === "deposit")
    .reduce((s, t) => s + t.amount, 0);
  const annualRevenue = totalDeposits > 0 ? (totalDeposits / safeDays) * 365 : 0;
  let marginExpansion = 0;
  if (annualRevenue > 0) {
    const marginImpact = (annualCost / annualRevenue) * 100;
    marginExpansion = Math.min(100, Math.round(marginImpact * 2));
  }

  // Overall weighted
  const overall = Math.round(
    dataQuality * 0.35 +
      (100 - acquisitionRiskRaw) * 0.3 +
      automationPotential * 0.2 +
      marginExpansion * 0.15
  );
  const clampedOverall = Math.max(0, Math.min(100, overall));

  let grade: "A" | "B" | "C" | "D" = "D";
  if (clampedOverall >= 85) grade = "A";
  else if (clampedOverall >= 70) grade = "B";
  else if (clampedOverall >= 50) grade = "C";

  return {
    dataQuality,
    acquisitionRisk: acquisitionRiskRaw,
    automationPotential,
    marginExpansion,
    overall: clampedOverall,
    grade,
  };
}

export function calculateHoursLost(
  anomalies: Anomaly[],
  dateRangeDays: number
): number {
  const totalMins = anomalies.reduce((s, a) => s + a.totalManualFixMins, 0);
  const safeDays = dateRangeDays <= 0 ? 1 : dateRangeDays;
  const normalized = (totalMins / 60) * (30 / safeDays);
  return parseFloat(normalized.toFixed(1));
}

const TOP_ISSUE_TYPE_ORDER: Record<string, number> = {
  duplicate: 0,
  unreconciled: 1,
  ap_aging: 2,
  ar_aging: 3,
  ghost_transaction: 4,
  miscategorized: 5,
  round_number: 6,
  expense_spike: 7,
};

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    duplicate: "duplicate",
    unreconciled: "unreconciled",
    miscategorized: "miscategorized",
    ap_aging: "AP aging",
    ar_aging: "AR aging",
    round_number: "round number",
    ghost_transaction: "ghost",
    expense_spike: "expense spike",
  };
  return labels[type] ?? type;
}

function buildTopIssue(topAnomaly: Anomaly): TopIssue {
  const hoursFixed = (topAnomaly.totalManualFixMins / 60).toFixed(1);
  const plainEnglishDescription = `Your ${topAnomaly.account} account has ${topAnomaly.count} ${typeLabel(topAnomaly.type)} entries totalling $${topAnomaly.dollarExposure.toLocaleString()} — estimated ${hoursFixed} hours to fix manually.`;
  const timeSavedMins = Math.max(0, topAnomaly.totalManualFixMins - 3);
  return {
    ...topAnomaly,
    plainEnglishDescription,
    quantoFixTime: "< 3 minutes",
    timeSavedMins,
  };
}

export function buildScorecard(
  transactions: QBOTransaction[],
  firmName: string
): ScorecardResult {
  const generatedAt = new Date();
  const dates = transactions.map((t) => t.date.getTime());
  const minT = dates.length ? Math.min(...dates) : generatedAt.getTime();
  const maxT = dates.length ? Math.max(...dates) : generatedAt.getTime();
  const datasetEnd = new Date(maxT);
  const dateRangeDays = Math.max(
    1,
    daysBetween(new Date(minT), new Date(maxT))
  );

  const duplicates = detectDuplicates(transactions, datasetEnd);
  const unreconciled = detectUnreconciled(transactions, datasetEnd);
  const miscategorized = detectMiscategorized(transactions, datasetEnd);
  const apAging = detectAPAging(transactions, datasetEnd);
  const arAging = detectARAging(transactions, datasetEnd);
  const roundNumbers = detectRoundNumbers(transactions, datasetEnd);
  const ghostTransactions = detectGhostTransactions(transactions, datasetEnd);

  const allAnomalies = [
    ...duplicates,
    ...unreconciled,
    ...miscategorized,
    ...apAging,
    ...arAging,
    ...roundNumbers,
    ...ghostTransactions,
  ];

  const accounts = calculateReconciliationLag(
    transactions,
    allAnomalies,
    datasetEnd
  );

  const hoursLostPerMonth = calculateHoursLost(allAnomalies, dateRangeDays);
  const totalManualFixMins = allAnomalies.reduce(
    (s, a) => s + a.totalManualFixMins,
    0
  );
  const projectedAnnualSavings = Math.round(hoursLostPerMonth * 12 * 150);
  const cleanupCostEstimate = Math.round((totalManualFixMins / 60) * 150);
  const totalAnomalies = allAnomalies.reduce((s, a) => s + a.count, 0);
  const totalDollarExposure = allAnomalies.reduce(
    (s, a) => s + a.dollarExposure,
    0
  );

  const scores = calculateScores(
    allAnomalies,
    accounts,
    transactions,
    hoursLostPerMonth,
    dateRangeDays
  );

  const avgReconciliationLagDays =
    accounts.length === 0
      ? 0
      : parseFloat(
          (
            accounts.reduce((s, a) => s + a.avgLagDays, 0) / accounts.length
          ).toFixed(1)
        );

  const topAnomaly =
    allAnomalies.length === 0
      ? null
      : [...allAnomalies].sort((a, b) => {
          if (b.totalManualFixMins !== a.totalManualFixMins)
            return b.totalManualFixMins - a.totalManualFixMins;
          return (
            (TOP_ISSUE_TYPE_ORDER[a.type] ?? 99) -
            (TOP_ISSUE_TYPE_ORDER[b.type] ?? 99)
          );
        })[0];

  const topIssue = topAnomaly
    ? buildTopIssue(topAnomaly)
    : buildTopIssue({
        type: "duplicate",
        account: "—",
        count: 0,
        totalManualFixMins: 0,
        dollarExposure: 0,
        severity: "low",
        transactions: [],
      });

  return {
    firmName,
    generatedAt,
    scores,
    avgReconciliationLagDays,
    totalAnomalies,
    hoursLostPerMonth,
    projectedAnnualSavings,
    totalDollarExposure,
    cleanupCostEstimate,
    accounts,
    anomalies: allAnomalies,
    topIssue,
    viewMode: "buyer",
  };
}
