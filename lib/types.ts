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
  mode: "buyer" | "seller";
  dataQualityScore: number;
  /** labeled 'Valuation Risk' in seller mode UI only */
  acquisitionRiskScore: number;
  automationPotentialScore: number;
  marginExpansionScore: number;
  overallGrade: "A" | "B" | "C" | "D";
  scoreBreakdowns: ScoreBreakdown[];
  accounts: AccountHealth[];
  anomalies: Anomaly[];
  topIssue: TopIssue;
  /** AP aging total + AR aging total */
  liabilityExposure: number;
  /** total manual fix mins / 60 * 150 */
  cleanupCostEstimate: number;
  hoursLostPerMonth: number;
  projectedAnnualSavings: number;
  aiNarrative: string | null;
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
}

export interface SampleDefinition {
  id: string;
  firmName: string;
  description: string;
  grade: "A" | "B" | "C" | "D";
  transactions: QBOTransaction[];
}
