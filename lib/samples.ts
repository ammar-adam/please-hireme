import type { QBOTransaction, SampleDefinition, ScorecardResult } from "./types";

// ── Helpers ────────────────────────────────────────────────────────

const NOW = new Date();
function daysAgo(days: number): Date {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d;
}

let _sampleCounter = 0;
function tx(
  prefix: string,
  date: Date,
  account: string,
  type: string,
  name: string,
  amount: number,
  balance: number | null,
  memo = ""
): QBOTransaction {
  _sampleCounter++;
  return {
    id: `sample-${prefix}-${String(_sampleCounter).padStart(3, "0")}`,
    date,
    transactionType: type,
    num: "",
    name,
    memo,
    account,
    split: "",
    amount,
    balance,
  };
}

const VENDORS = [
  "Bell Canada", "WeWork", "Stripe", "Shopify", "Office Depot",
  "Rogers", "Salesforce", "Adobe", "AWS", "Uber Eats",
  "FedEx", "CIBC", "RBC", "TD Bank",
];

const ACCOUNTS = ["Chequing", "Accounts Receivable", "Accounts Payable", "Credit Card", "Savings"];

// ── Maple Advisory Group (Grade D — messy books) ───────────────────

function buildMapleTransactions(): QBOTransaction[] {
  _sampleCounter = 0;
  const prefix = "maple";
  const list: QBOTransaction[] = [];
  let cheqBal = 24000;

  // 12 duplicate pairs — same vendor, same amount, within 7 days
  const dupPairs: [string, number, number, string][] = [
    ["Bell Canada", 450, 10, "Chequing"],
    ["WeWork", 2800, 18, "Chequing"],
    ["Stripe", 199.99, 25, "Chequing"],
    ["Shopify", 320, 35, "Chequing"],
    ["Office Depot", 175, 42, "Accounts Payable"],
    ["Rogers", 89, 50, "Accounts Payable"],
    ["Salesforce", 1200, 58, "Chequing"],
    ["Adobe", 54.99, 65, "Credit Card"],
    ["AWS", 890, 72, "Chequing"],
    ["Uber Eats", 45, 80, "Credit Card"],
    ["FedEx", 120, 88, "Accounts Payable"],
    ["Bell Canada", 450, 95, "Chequing"],
  ];
  for (const [vendor, amount, day, account] of dupPairs) {
    const bal = account === "Chequing" ? cheqBal - amount : null;
    list.push(tx(prefix, daysAgo(day), account, "Expense", vendor, amount, bal, `Payment to ${vendor}`));
    list.push(tx(prefix, daysAgo(day - 3), account, "Expense", vendor, amount, bal, `Payment to ${vendor}`));
  }

  // 72 unreconciled items — older than 30 days, balance null, type not Deposit/Payment
  for (let i = 0; i < 72; i++) {
    const vendor = VENDORS[i % VENDORS.length];
    const day = 35 + i * 4;
    const amount = 80 + i * 25;
    list.push(tx(prefix, daysAgo(day), i % 3 === 0 ? "Chequing" : i % 3 === 1 ? "Accounts Payable" : "Credit Card", "Expense", vendor, amount, null, "Unreconciled item"));
  }

  // 15 miscategorized — blank name or Uncategorized Expense
  for (let i = 0; i < 8; i++) {
    list.push(tx(prefix, daysAgo(15 + i * 10), "Uncategorized Expense", "Expense", VENDORS[i], 80 + i * 20, null, "Needs categorization"));
  }
  for (let i = 0; i < 7; i++) {
    list.push(tx(prefix, daysAgo(20 + i * 12), "Chequing", "Expense", "", 600 + i * 100, cheqBal - 600, ""));
  }

  // Round-number transactions: exact $1000 multiples above $2000 (triggers detector)
  const roundAmounts = [2000, 3000, 5000, 2000, 4000, 3000, 5000, 6000, 2000, 3000];
  for (let i = 0; i < roundAmounts.length; i++) {
    list.push(tx(prefix, daysAgo(10 + i * 14), "Chequing", "Expense", `Vendor ${String.fromCharCode(65 + i)}`, roundAmounts[i], cheqBal - roundAmounts[i], "Estimate"));
  }

  // Heavy AP aging: ~$55k+ outstanding > 60 days → big Operational Risk penalty
  const apAmounts = [12000, 10000, 9000, 8000, 7000, 5000];
  for (let i = 0; i < apAmounts.length; i++) {
    list.push(tx(prefix, daysAgo(70 + i * 8), "Accounts Payable", "Bill", VENDORS[i], apAmounts[i], null, "Outstanding bill"));
  }

  // Heavy AR aging: ~$35k+ > 90 days
  const arAmounts = [10000, 9000, 8000, 7000, 6000];
  for (let i = 0; i < arAmounts.length; i++) {
    list.push(tx(prefix, daysAgo(100 + i * 10), "Accounts Receivable", "Invoice", `Client ${String.fromCharCode(65 + i)}`, arAmounts[i], null, "Unpaid invoice"));
  }

  // Strong owner dependency: 18+ transactions with "Owner" in name → 12 pts + concentration
  for (let i = 0; i < 18; i++) {
    list.push(tx(prefix, daysAgo(5 + i * 12), "Chequing", "Expense", "John Smith - Owner", 500 + i * 200, cheqBal - 500, "Owner draw"));
  }

  // 3 stale accounts (same balance, long gaps) → critical status → capped OpRisk penalty from accounts
  const staleAccounts = ["Savings", "Line of Credit", "Petty Cash"];
  const staleBal = 5000;
  for (const acc of staleAccounts) {
    list.push(tx(prefix, daysAgo(200), acc, "Expense", "Misc", 0, staleBal, "Opening"));
    list.push(tx(prefix, daysAgo(180), acc, "Expense", "Misc", 0, staleBal, "No activity"));
    list.push(tx(prefix, daysAgo(160), acc, "Expense", "Misc", 0, staleBal, "No activity"));
  }

  // Three accounts with unexplained balance jumps (≥$15k) so balance_jump detector adds OpRisk penalty
  list.push(tx(prefix, daysAgo(120), "Line of Credit", "Expense", "Unknown", 0, 20000, ""));
  list.push(tx(prefix, daysAgo(118), "Line of Credit", "Expense", "Unknown", 0, 5000, ""));
  list.push(tx(prefix, daysAgo(95), "Reserve", "Expense", "Unknown", 0, 18000, ""));
  list.push(tx(prefix, daysAgo(93), "Reserve", "Expense", "Unknown", 0, 3000, ""));
  list.push(tx(prefix, daysAgo(80), "Other Receivable", "Expense", "Unknown", 0, 26000, ""));
  list.push(tx(prefix, daysAgo(78), "Other Receivable", "Expense", "Unknown", 0, 10000, ""));

  // Fill remaining with normal transactions to reach 200+
  for (let i = 0; list.length < 210; i++) {
    const day = 1 + (i % 350);
    const acc = ACCOUNTS[i % 4];
    const vendor = VENDORS[i % VENDORS.length];
    const isDeposit = i % 6 === 0;
    const isInvoice = i % 6 === 1;
    const type = isDeposit ? "Deposit" : isInvoice ? "Invoice" : i % 6 === 2 ? "Bill" : "Expense";
    const amount = isDeposit ? 3000 + i * 50 : 150 + i * 12;
    const bal = isDeposit ? cheqBal + amount : acc === "Chequing" ? cheqBal - amount : null;
    list.push(tx(prefix, daysAgo(day), acc, type, vendor, Math.abs(amount), bal, "Regular transaction"));
  }

  return list;
}

// ── Cedar Table Restaurant (Grade A — clean books) ─────────────────

function buildCedarTransactions(): QBOTransaction[] {
  _sampleCounter = 0;
  const prefix = "cedar";
  const list: QBOTransaction[] = [];
  let cheqBal = 45000;

  // Regular monthly expenses — well categorized, consistent
  for (let month = 0; month < 12; month++) {
    const baseDay = month * 30 + 5;
    // Regular vendor payments
    for (let v = 0; v < VENDORS.length; v++) {
      const amount = 200 + v * 50 + (month % 3) * 10;
      cheqBal -= amount;
      list.push(tx(prefix, daysAgo(baseDay + v * 2), "Chequing", "Expense", VENDORS[v], amount, cheqBal, `Monthly ${VENDORS[v]} payment`));
    }

    // Revenue deposits — regular
    const revenue = 8000 + month * 200;
    cheqBal += revenue;
    list.push(tx(prefix, daysAgo(baseDay), "Chequing", "Deposit", "Daily Sales", revenue, cheqBal, "POS deposit"));

    // AP paid within 30 days
    if (month % 2 === 0) {
      list.push(tx(prefix, daysAgo(baseDay + 15), "Accounts Payable", "Bill", VENDORS[month % VENDORS.length], 1200, -1200, "Supplier invoice"));
      list.push(tx(prefix, daysAgo(baseDay + 25), "Accounts Payable", "Payment", VENDORS[month % VENDORS.length], 1200, 0, "Paid supplier"));
    }

    // AR collected within 45 days
    if (month % 3 === 0) {
      list.push(tx(prefix, daysAgo(baseDay), "Accounts Receivable", "Invoice", `Catering Client ${month}`, 2500, 2500, "Catering invoice"));
      list.push(tx(prefix, daysAgo(baseDay - 30), "Accounts Receivable", "Payment", `Catering Client ${month}`, 2500, 0, "Payment received"));
    }
  }

  // 4 unreconciled only — minimal blip so Book Quality stays high but Automation Fit gets a small bump (needed for avg ≥ 85)
  list.push(tx(prefix, daysAgo(45), "Chequing", "Expense", "FedEx", 85, null, "Pending reconciliation"));
  list.push(tx(prefix, daysAgo(50), "Credit Card", "Expense", "Rogers", 120, null, "Pending reconciliation"));
  list.push(tx(prefix, daysAgo(55), "Chequing", "Expense", "Bell Canada", 95, null, "Pending reconciliation"));
  list.push(tx(prefix, daysAgo(60), "Chequing", "Expense", "Office Depot", 110, null, "Pending reconciliation"));

  // No duplicates, no miscategorized, no round numbers, no AP/AR aging, no owner dependency — bonafide A

  // Fill to 155
  while (list.length < 155) {
    const i = list.length;
    const day = 1 + (i % 340);
    const vendor = VENDORS[i % VENDORS.length];
    cheqBal -= 100;
    list.push(tx(prefix, daysAgo(day), "Chequing", "Expense", vendor, 100 + (i % 50), cheqBal, "Operating expense"));
  }

  return list;
}

// ── Lakeview Bookkeeping Co. (Grade C — workable but clear friction; not D) ────────

function buildLakeviewTransactions(): QBOTransaction[] {
  _sampleCounter = 0;
  const prefix = "lakeview";
  const list: QBOTransaction[] = [];
  let cheqBal = 32000;

  // 7 duplicate pairs (14 pts cap) + 16 unreconciled (18 pts cap) + 8 miscat (10 pts cap) + 5 round → BQ penalty 47 → BQ 53
  const dupPairs: [string, number, number][] = [
    ["Bell Canada", 450, 10], ["Rogers", 89, 25], ["Office Depot", 200, 40], ["FedEx", 85, 55],
    ["Stripe", 199, 85], ["Shopify", 320, 95], ["AWS", 150, 105],
  ];
  for (const [vendor, amount, day] of dupPairs) {
    list.push(tx(prefix, daysAgo(day), "Chequing", "Expense", vendor, amount, cheqBal - amount, "Payment"));
    list.push(tx(prefix, daysAgo(day - 2), "Chequing", "Expense", vendor, amount, cheqBal - amount, "Payment"));
  }

  // 16 unreconciled (hits cap 18 pts)
  for (let i = 0; i < 16; i++) {
    list.push(tx(prefix, daysAgo(35 + i * 4), i < 10 ? "Chequing" : "Credit Card", "Expense", VENDORS[i % VENDORS.length], 150 + i * 25, null, "Pending reconciliation"));
  }

  // 8 miscategorized (hits cap 10 pts)
  for (let i = 0; i < 4; i++) {
    list.push(tx(prefix, daysAgo(20 + i * 15), "Uncategorized Expense", "Expense", VENDORS[i], 100 + i * 30, null, "Needs categorization"));
  }
  list.push(tx(prefix, daysAgo(50), "Chequing", "Expense", "", 600, null, ""));
  list.push(tx(prefix, daysAgo(55), "Chequing", "Expense", "", 750, null, ""));
  list.push(tx(prefix, daysAgo(60), "Chequing", "Expense", "", 800, null, ""));
  list.push(tx(prefix, daysAgo(65), "Chequing", "Expense", "", 650, null, ""));

  // 5 round-number expenses (≥$2000) so round_number detector adds penalty (cap 5 pts)
  const roundAmounts = [2000, 3000, 2000, 3000, 5000];
  for (let i = 0; i < roundAmounts.length; i++) {
    list.push(tx(prefix, daysAgo(12 + i * 18), "Chequing", "Expense", `Vendor ${String.fromCharCode(65 + i)}`, roundAmounts[i], cheqBal - roundAmounts[i], "Estimate"));
  }

  // AP ~$35k, AR ~$25k → higher OpRisk penalty so grade lands in C; 4 critical (stale) accounts → +12 capped
  list.push(tx(prefix, daysAgo(75), "Accounts Payable", "Bill", "Bell Canada", 9000, null, "Outstanding"));
  list.push(tx(prefix, daysAgo(80), "Accounts Payable", "Bill", "Rogers", 8000, null, "Outstanding"));
  list.push(tx(prefix, daysAgo(85), "Accounts Payable", "Bill", "WeWork", 7000, null, "Outstanding"));
  list.push(tx(prefix, daysAgo(92), "Accounts Payable", "Bill", "Office Depot", 5500, null, "Outstanding"));
  list.push(tx(prefix, daysAgo(95), "Accounts Payable", "Bill", "AWS", 3500, null, "Outstanding"));
  list.push(tx(prefix, daysAgo(100), "Accounts Receivable", "Invoice", "Client A", 7000, null, "Overdue"));
  list.push(tx(prefix, daysAgo(105), "Accounts Receivable", "Invoice", "Client B", 6000, null, "Overdue"));
  list.push(tx(prefix, daysAgo(112), "Accounts Receivable", "Invoice", "Client C", 6000, null, "Overdue"));
  list.push(tx(prefix, daysAgo(118), "Accounts Receivable", "Invoice", "Client D", 5000, null, "Overdue"));

  // 4 stale accounts → critical status → OpRisk penalty (capped)
  const staleBal = 3000;
  for (const acc of ["Savings", "Line of Credit", "Petty Cash", "Other Receivable"]) {
    list.push(tx(prefix, daysAgo(180), acc, "Expense", "Misc", 0, staleBal, "Opening"));
    list.push(tx(prefix, daysAgo(160), acc, "Expense", "Misc", 0, staleBal, "No activity"));
    list.push(tx(prefix, daysAgo(140), acc, "Expense", "Misc", 0, staleBal, "No activity"));
  }

  // Owner concentration: 8 tx with "Owner" in name
  for (let i = 0; i < 8; i++) {
    list.push(tx(prefix, daysAgo(5 + i * 12), "Chequing", "Expense", "David Park - Owner", 500 + i * 80, cheqBal - 500, "Owner draw"));
  }

  // Regular transactions to fill
  for (let month = 0; month < 12; month++) {
    const baseDay = month * 30;
    list.push(tx(prefix, daysAgo(baseDay + 1), "Chequing", "Deposit", "Client Payments", 5000 + month * 200, cheqBal + 5000, "Monthly revenue"));
    for (let v = 0; v < 5; v++) {
      list.push(tx(prefix, daysAgo(baseDay + 3 + v * 2), "Chequing", "Expense", VENDORS[v], 120 + v * 35, cheqBal - 120, "Operating"));
    }
  }

  while (list.length < 165) {
    const i = list.length;
    list.push(tx(prefix, daysAgo(1 + (i % 340)), "Chequing", "Expense", VENDORS[i % VENDORS.length], 80 + (i % 60), cheqBal - 80, "Operating expense"));
  }

  return list;
}

// ── Export Samples ─────────────────────────────────────────────────
// Order: A (Cedar), B (Lakeview), D (Maple) for clear demo spread.

export const healthyFirm: SampleDefinition = {
  id: "cedar",
  firmName: "Cedar Table Restaurant",
  description: "Clean books, low operational risk, easy to onboard",
  transactions: buildCedarTransactions(),
};

export const acquisitionTarget: SampleDefinition = {
  id: "lakeview",
  firmName: "Lakeview Bookkeeping Co.",
  description: "Workable books with meaningful operational friction; standardize workflows and unlock capacity",
  transactions: buildLakeviewTransactions(),
};

export const messyFirm: SampleDefinition = {
  id: "maple",
  firmName: "Maple Advisory Group",
  description: "Messy acquisition target with major cleanup burden and hidden risk",
  transactions: buildMapleTransactions(),
};

export const ALL_SAMPLES: SampleDefinition[] = [healthyFirm, acquisitionTarget, messyFirm];

// ── Download CSV Helper ────────────────────────────────────────────

export function transactionsToCSV(transactions: QBOTransaction[]): string {
  const headers = ["Date", "Transaction Type", "Num", "Name", "Memo/Description", "Account", "Split", "Amount", "Balance"];
  const rows = transactions.map((t) => [
    t.date.toLocaleDateString("en-US"),
    t.transactionType,
    t.num,
    t.name,
    t.memo,
    t.account,
    t.split,
    t.amount.toFixed(2),
    t.balance != null ? t.balance.toFixed(2) : "",
  ]);
  return [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
}

export function downloadAsCSV(transactions: QBOTransaction[], firmName: string): void {
  const csv = transactionsToCSV(transactions);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${firmName.replace(/\s+/g, "_")}_export.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
