export interface QBOTransaction {
  date: Date;
  transactionType: string;
  num: string;
  name: string;
  memo: string;
  account: string;
  split: string;
  amount: number;
  /** null when Balance cell is blank or unparseable */
  balance: number | null;
}

export interface AccountHealth {
  accountName: string;
  avgLagDays: number;
  daysSinceLastReconciled: number;
  /** number of pairs, not individual transactions */
  duplicatePairCount: number;
  unreconciledCount: number;
  miscategorizedCount: number;
  /** sum of dollar amounts tied to anomalies in this account */
  totalExposureAmount: number;
  status: "healthy" | "warning" | "critical";
}

export type AnomalyType =
  | "duplicate"
  | "unreconciled"
  | "miscategorized"
  | "ap_aging"
  | "ar_aging"
  | "expense_spike"
  | "round_number"
  | "ghost_transaction";

export interface AnomalyTransaction {
  date: Date;
  name: string;
  memo: string;
  account: string;
  amount: number;
  transactionType: string;
  /** plain English: why this specific transaction was flagged */
  flagReason: string;
}

export interface Anomaly {
  type: AnomalyType;
  account: string;
  /** for duplicate: pair count. for others: item count. */
  count: number;
  /** count * per-item rate */
  totalManualFixMins: number;
  /** sum of Amount across all transactions in this anomaly group */
  dollarExposure: number;
  severity: "high" | "medium" | "low";
  /** the actual transactions causing this anomaly — used for drill-down */
  transactions: AnomalyTransaction[];
}

export interface TopIssue extends Anomaly {
  /** Template: 'Your {account} account has {count} {typeLabel} entries totalling ${dollarExposure} — estimated {hoursFixed} hours to fix manually.' */
  plainEnglishDescription: string;
  /** Always hardcoded: '< 3 minutes' */
  quantoFixTime: string;
  /** totalManualFixMins minus 3 */
  timeSavedMins: number;
}

export interface FirmScores {
  /** 0–100 */
  dataQuality: number;
  /** 0–100. Higher = more risky. Stored as raw; display as (100 - raw) so higher = safer */
  acquisitionRisk: number;
  /** 0–100 */
  automationPotential: number;
  /** 0–100 */
  marginExpansion: number;
  /** 0–100. Weighted composite */
  overall: number;
  grade: "A" | "B" | "C" | "D";
}

export interface ScorecardResult {
  firmName: string;
  generatedAt: Date;
  scores: FirmScores;
  avgReconciliationLagDays: number;
  /** sum of all anomaly.count values */
  totalAnomalies: number;
  hoursLostPerMonth: number;
  /** hoursLostPerMonth * 12 * 150 */
  projectedAnnualSavings: number;
  /** sum of dollarExposure across all anomalies */
  totalDollarExposure: number;
  /** (total manual fix mins / 60) * 150 */
  cleanupCostEstimate: number;
  accounts: AccountHealth[];
  anomalies: Anomaly[];
  topIssue: TopIssue;
  /** UI toggle — does not affect calculation, only framing of displayed copy */
  viewMode: "buyer" | "seller";
}
