import type {
  QBOTransaction,
  Anomaly,
  AccountHealth,
  TopIssue,
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

export function parseTransactions(
  rows: Record<string, string>[]
): QBOTransaction[] {
  const result: QBOTransaction[] = [];
  for (const row of rows) {
    const dateStr = row["Date"] ?? "";
    const date = new Date(dateStr);
    const amountStr = (row["Amount"] ?? "").replace(/,/g, "");
    const amount = parseFloat(amountStr);
    const balanceStr = (row["Balance"] ?? "").trim().replace(/,/g, "");
    const balanceParsed = balanceStr === "" ? NaN : parseFloat(balanceStr);
    const balance: number | null = Number.isNaN(balanceParsed)
      ? null
      : balanceParsed;

    if (isInvalidDate(date) || Number.isNaN(amount)) continue;

    result.push({
      date,
      transactionType: row["Transaction Type"] ?? "",
      num: row["Num"] ?? "",
      name: (row["Name"] ?? "").trim(),
      memo: (row["Memo/Description"] ?? "").trim(),
      account: (row["Account"] ?? "").trim(),
      split: row["Split"] ?? "",
      amount,
      balance,
    });
  }
  return result;
}

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
    let pairCount = 0;
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
        const within7 = daysDiff <= 7;
        if (amountMatch && nameMatch && within7) {
          pairCount++;
          used.add(i);
          used.add(j);
          break;
        }
      }
    }
    if (pairCount > 0) {
      anomalies.push({
        type: "duplicate",
        account,
        count: pairCount,
        totalManualFixMins: pairCount * 25,
        severity: "high",
      });
    }
  }
  return anomalies;
}

export function detectUnreconciled(transactions: QBOTransaction[]): Anomaly[] {
  const today = new Date();
  const cutoff = new Date(today);
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
  for (const [account, list] of byAccount) {
    anomalies.push({
      type: "unreconciled",
      account,
      count: list.length,
      totalManualFixMins: list.length * 18,
      severity: "medium",
    });
  }
  return anomalies;
}

export function detectMiscategorized(
  transactions: QBOTransaction[]
): Anomaly[] {
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const blankName = t.name.trim() === "";
    const uncategorized = t.account.toLowerCase().includes("uncategorized");
    const blankMemoBigAmount = t.memo.trim() === "" && t.amount > 500;
    if (blankName || uncategorized || blankMemoBigAmount) {
      const key = t.account || "(blank)";
      if (!byAccount.has(key)) byAccount.set(key, []);
      byAccount.get(key)!.push(t);
    }
  }

  const anomalies: Anomaly[] = [];
  for (const [account, list] of byAccount) {
    anomalies.push({
      type: "miscategorized",
      account,
      count: list.length,
      totalManualFixMins: list.length * 12,
      severity: "low",
    });
  }
  return anomalies;
}

function getAnomalyCountsForAccount(
  accountName: string,
  anomalies: Anomaly[]
): {
  duplicatePairCount: number;
  unreconciledCount: number;
  miscategorizedCount: number;
} {
  let duplicatePairCount = 0;
  let unreconciledCount = 0;
  let miscategorizedCount = 0;
  for (const a of anomalies) {
    if (a.account !== accountName) continue;
    if (a.type === "duplicate") duplicatePairCount = a.count;
    if (a.type === "unreconciled") unreconciledCount = a.count;
    if (a.type === "miscategorized") miscategorizedCount = a.count;
  }
  return {
    duplicatePairCount,
    unreconciledCount,
    miscategorizedCount,
  };
}

export function calculateReconciliationLag(
  transactions: QBOTransaction[],
  anomalies: Anomaly[]
): AccountHealth[] {
  const today = new Date();
  const byAccount = new Map<string, QBOTransaction[]>();
  for (const t of transactions) {
    const key = t.account || "(blank)";
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(t);
  }

  const result: AccountHealth[] = [];
  for (const [accountName, list] of byAccount) {
    const sorted = [...list].sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
    const lagDurations: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const sameBalance = prev.balance === curr.balance;
      const gapDays = daysBetween(prev.date, curr.date);
      if (sameBalance && gapDays > 5) {
        lagDurations.push(gapDays);
      }
    }
    const avgLagDays =
      lagDurations.length === 0
        ? 0
        : lagDurations.reduce((s, d) => s + d, 0) / lagDurations.length;

    let status: "healthy" | "warning" | "critical" = "healthy";
    if (avgLagDays > 14) status = "critical";
    else if (avgLagDays >= 7) status = "warning";

    const latestDate =
      sorted.length > 0
        ? sorted[sorted.length - 1].date
        : new Date(0);
    const daysSinceLastReconciled = daysBetween(
      latestDate,
      today
    );

    const counts = getAnomalyCountsForAccount(accountName, anomalies);

    result.push({
      accountName,
      avgLagDays,
      unreconciledCount: counts.unreconciledCount,
      duplicatePairCount: counts.duplicatePairCount,
      miscategorizedCount: counts.miscategorizedCount,
      status,
      daysSinceLastReconciled,
    });
  }
  return result;
}

export function calculateHealthScore(
  anomalies: Anomaly[],
  accounts: AccountHealth[]
): number {
  let score = 100;
  for (const a of anomalies) {
    if (a.type === "duplicate") score -= 3 * a.count;
    else if (a.type === "unreconciled") score -= 2 * a.count;
    else if (a.type === "miscategorized") score -= 1.5 * a.count;
  }
  for (const acc of accounts) {
    if (acc.status === "warning") score -= 5;
    if (acc.status === "critical") score -= 10;
  }
  return Math.max(0, Math.round(score));
}

export function calculateHoursLost(
  anomalies: Anomaly[],
  dateRangeDays: number
): number {
  const totalMins = anomalies.reduce((s, a) => s + a.totalManualFixMins, 0);
  const safeDays = dateRangeDays <= 0 ? 1 : dateRangeDays;
  const hoursNormalized = (totalMins / 60) * (30 / safeDays);
  return parseFloat(hoursNormalized.toFixed(1));
}

function buildTopIssue(topAnomaly: Anomaly): TopIssue {
  const hoursFixed = (topAnomaly.totalManualFixMins / 60).toFixed(1);
  const plainEnglishDescription = `Your ${topAnomaly.account} has ${topAnomaly.count} ${topAnomaly.type} entries — estimated ${hoursFixed} hours to fix manually.`;
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
  const dateRangeDays = Math.max(
    1,
    daysBetween(new Date(minT), new Date(maxT))
  );

  const duplicates = detectDuplicates(transactions);
  const unreconciled = detectUnreconciled(transactions);
  const miscategorized = detectMiscategorized(transactions);
  const allAnomalies = [...duplicates, ...unreconciled, ...miscategorized];

  const accounts = calculateReconciliationLag(transactions, allAnomalies);
  const healthScore = calculateHealthScore(allAnomalies, accounts);
  const hoursLostPerMonth = calculateHoursLost(allAnomalies, dateRangeDays);

  const totalAnomalies = allAnomalies.reduce((s, a) => s + a.count, 0);
  const avgReconciliationLagDays =
    accounts.length === 0
      ? 0
      : accounts.reduce((s, a) => s + a.avgLagDays, 0) / accounts.length;
  const projectedAnnualSavings = Math.round(hoursLostPerMonth * 12 * 150);

  const topAnomaly =
    allAnomalies.length === 0
      ? null
      : [...allAnomalies].sort((a, b) => {
          if (b.totalManualFixMins !== a.totalManualFixMins)
            return b.totalManualFixMins - a.totalManualFixMins;
          const order = { duplicate: 0, unreconciled: 1, miscategorized: 2 };
          return order[a.type] - order[b.type];
        })[0];

  const topIssue = topAnomaly
    ? buildTopIssue(topAnomaly)
    : buildTopIssue({
        type: "duplicate",
        account: "—",
        count: 0,
        totalManualFixMins: 0,
        severity: "low",
      });

  return {
    firmName,
    generatedAt,
    healthScore,
    avgReconciliationLagDays,
    totalAnomalies,
    hoursLostPerMonth,
    projectedAnnualSavings,
    accounts,
    anomalies: allAnomalies,
    topIssue,
  };
}
