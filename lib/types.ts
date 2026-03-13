export interface QBOTransaction {
  id: string;
  date: Date;
  transactionType: string;
  num: string;
  name: string;
  memo: string;
  account: string;
  split: string;
  amount: number;
  /** blank CSV cells = null */
  balance: number | null;
}

export type AnomalyType =
  | "duplicate"
  | "unreconciled"
  | "miscategorized"
  | "ap_aging"
  | "ar_aging"
  | "owner_dependency"
  | "round_number"
  | "balance_jump";

export interface Anomaly {
  id: string;
  type: AnomalyType;
  account: string;
  count: number;
  affectedTransactions: QBOTransaction[];
  manualFixMins: number;
  dollarExposure: number;
  severity: "high" | "medium" | "low";
  /** plain English, references actual vendor names and amounts */
  mathExplanation: string;
}

export interface AccountHealth {
  accountName: string;
  avgLagDays: number;
  unreconciledCount: number;
  duplicateCount: number;
  miscategorizedCount: number;
  status: "healthy" | "warning" | "critical";
  daysSinceLastTransaction: number;
  /** sum of duplicate + unreconciled + miscategorized for this account */
  openIssues: number;
  affectedTransactions: QBOTransaction[];
}

export interface ScoreBreakdown {
  category: string;
  /** starting value before penalties */
  rawScore: number;
  /** sum of all deductions */
  penalty: number;
  /** plain English explanation */
  explanation: string;
  affectedAnomalies: Anomaly[];
}

export interface TopIssue extends Anomaly {
  plainEnglishDescription: string;
  /** always '< 3 minutes' */
  quantoFixTime: string;
  timeSavedMins: number;
}

export interface ScorecardResult {
  firmName: string;
  generatedAt: Date;
  /** Display: Book Quality */
  dataQualityScore: number;
  /** Display: Operational Risk (higher = lower risk) */
  acquisitionRiskScore: number;
  /** Display: Automation Fit */
  automationPotentialScore: number;
  /** Display: Scale Readiness */
  scaleReadinessScore: number;
  overallGrade: "A" | "B" | "C" | "D";
  scoreBreakdowns: ScoreBreakdown[];
  accounts: AccountHealth[];
  anomalies: Anomaly[];
  topIssue: TopIssue;
  /** Deterministic value narrative by grade band */
  valueProfile: { gradeBand: "A" | "B" | "C" | "D"; headline: string; narrative: string };
  liabilityExposure: number;
  cleanupCostEstimate: number;
  hoursLostPerMonth: number;
  /** Annual hours recovered (hoursLostPerMonth * 12) */
  estimatedAnnualTimeRecoveryHours: number;
  /** Annual margin recovery at $45/hr */
  projectedAnnualSavings: number;
  hiddenFinancialExposure?: number;
  aiNarrative: string | null;
  aiSummaryStatus?: "idle" | "loading" | "done" | "error";
  dateRangeDays?: number;
}

export type PanelType = "score" | "anomaly" | "account" | "stat";

export interface PanelContext {
  type: PanelType;
  payload: ScoreBreakdown | Anomaly | AccountHealth | StatPayload;
}

export interface StatPayload {
  name: string;
  value: number | string;
  explanation: string;
  relatedAnomalies?: Anomaly[];
  relatedAccounts?: AccountHealth[];
  /** Full result for stat panel breakdowns (per-account, by-type, formulas) */
  result?: ScorecardResult;
}

export interface SampleDefinition {
  id: string;
  firmName: string;
  description: string;
  /** Optional; when absent, grade is computed at load time via buildScorecard */
  grade?: "A" | "B" | "C" | "D";
  transactions: QBOTransaction[];
}
