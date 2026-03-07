export interface QBOTransaction {
  date: Date;
  transactionType: string;
  num: string;
  name: string;
  memo: string;
  account: string;
  split: string;
  amount: number;
  /** null when the Balance cell is blank or unparseable */
  balance: number | null;
}

export interface AccountHealth {
  accountName: string;
  avgLagDays: number;
  unreconciledCount: number;
  /** number of pairs, not individual transactions */
  duplicatePairCount: number;
  miscategorizedCount: number;
  status: "healthy" | "warning" | "critical";
  daysSinceLastReconciled: number;
}

export interface Anomaly {
  type: "duplicate" | "unreconciled" | "miscategorized";
  account: string;
  /** for type=duplicate this is pair count. for others it is item count. */
  count: number;
  /** count * per-item rate. rates: duplicate=25, unreconciled=18, miscategorized=12 */
  totalManualFixMins: number;
  severity: "high" | "medium" | "low";
}

export interface TopIssue extends Anomaly {
  /** Interpolate exactly: 'Your {account} has {count} {type} entries — estimated {hoursFixed} hours to fix manually.' where hoursFixed = (totalManualFixMins/60).toFixed(1) */
  plainEnglishDescription: string;
  /** Hardcoded string: '< 3 minutes' */
  quantoFixTime: string;
  /** totalManualFixMins minus 3 */
  timeSavedMins: number;
}

export interface ScorecardResult {
  firmName: string;
  generatedAt: Date;
  /** integer 0–100 */
  healthScore: number;
  /** mean across all accounts */
  avgReconciliationLagDays: number;
  /** sum of all anomaly.count values across all anomalies */
  totalAnomalies: number;
  hoursLostPerMonth: number;
  projectedAnnualSavings: number;
  accounts: AccountHealth[];
  anomalies: Anomaly[];
  topIssue: TopIssue;
}
