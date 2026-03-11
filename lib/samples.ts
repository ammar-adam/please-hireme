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

  // 22 unreconciled items — older than 30 days, balance null, type not Deposit/Payment
  for (let i = 0; i < 22; i++) {
    const vendor = VENDORS[i % VENDORS.length];
    const day = 35 + i * 5;
    const amount = 100 + i * 30;
    list.push(tx(prefix, daysAgo(day), i < 11 ? "Chequing" : "Accounts Payable", "Expense", vendor, amount, null, "Unreconciled item"));
  }

  // 15 miscategorized — blank name or Uncategorized Expense
  for (let i = 0; i < 8; i++) {
    list.push(tx(prefix, daysAgo(15 + i * 10), "Uncategorized Expense", "Expense", VENDORS[i], 80 + i * 20, null, "Needs categorization"));
  }
  for (let i = 0; i < 7; i++) {
    list.push(tx(prefix, daysAgo(20 + i * 12), "Chequing", "Expense", "", 600 + i * 100, cheqBal - 600, ""));
  }

  // 8 round-number transactions over $1000
  const roundAmounts = [1000, 1500, 2000, 2500, 3000, 1500, 2000, 5000];
  for (let i = 0; i < 8; i++) {
    list.push(tx(prefix, daysAgo(10 + i * 14), "Chequing", "Expense", `Vendor ${String.fromCharCode(65 + i)}`, roundAmounts[i], cheqBal - roundAmounts[i], "Estimate"));
  }

  // $18,000 AP outstanding > 60 days
  const apAmounts = [4500, 3200, 2800, 3500, 4000];
  for (let i = 0; i < apAmounts.length; i++) {
    list.push(tx(prefix, daysAgo(70 + i * 8), "Accounts Payable", "Bill", VENDORS[i], apAmounts[i], null, "Outstanding bill"));
  }

  // $9,000 AR outstanding > 90 days
  const arAmounts = [3000, 2500, 3500];
  for (let i = 0; i < arAmounts.length; i++) {
    list.push(tx(prefix, daysAgo(100 + i * 10), "Accounts Receivable", "Invoice", `Client ${String.fromCharCode(65 + i)}`, arAmounts[i], null, "Unpaid invoice"));
  }

  // 6 transactions referencing "John Smith" — owner dependency
  for (let i = 0; i < 6; i++) {
    list.push(tx(prefix, daysAgo(5 + i * 15), "Chequing", "Expense", "John Smith", 500 + i * 200, cheqBal - 500, "Owner expense"));
  }

  // Fill remaining with normal transactions to reach 150+
  for (let i = 0; list.length < 155; i++) {
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

  // Only 2 miscategorized (minor)
  list.push(tx(prefix, daysAgo(45), "Uncategorized Expense", "Expense", "Office Depot", 35, null, "Misc office supply"));
  list.push(tx(prefix, daysAgo(120), "Uncategorized Expense", "Expense", "FedEx", 22, null, "Shipping"));

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

// ── Lakeview Bookkeeping Co. (Grade C — acquisition target) ────────

function buildLakeviewTransactions(): QBOTransaction[] {
  _sampleCounter = 0;
  const prefix = "lakeview";
  const list: QBOTransaction[] = [];
  let cheqBal = 32000;

  // 15 transactions referencing owner "David Park"
  for (let i = 0; i < 15; i++) {
    const amount = 800 + i * 150;
    list.push(tx(prefix, daysAgo(5 + i * 8), "Chequing", "Expense", "David Park", amount, cheqBal - amount, "Owner expense"));
  }

  // $32,000 AP aging > 90 days
  const apItems: [string, number, number][] = [
    ["Bell Canada", 6500, 95],
    ["WeWork", 8000, 100],
    ["Rogers", 5500, 108],
    ["AWS", 7000, 115],
    ["Salesforce", 5000, 120],
  ];
  for (const [vendor, amount, day] of apItems) {
    list.push(tx(prefix, daysAgo(day), "Accounts Payable", "Bill", vendor, amount, null, "Outstanding payable"));
  }

  // $21,000 AR > 120 days likely uncollectable
  const arItems: [string, number, number][] = [
    ["Client Alpha", 7000, 125],
    ["Client Beta", 5500, 130],
    ["Client Gamma", 4500, 140],
    ["Client Delta", 4000, 150],
  ];
  for (const [client, amount, day] of arItems) {
    list.push(tx(prefix, daysAgo(day), "Accounts Receivable", "Invoice", client, amount, null, "Overdue invoice"));
  }

  // 18 unreconciled items
  for (let i = 0; i < 18; i++) {
    const vendor = VENDORS[i % VENDORS.length];
    const day = 35 + i * 6;
    list.push(tx(prefix, daysAgo(day), i < 9 ? "Chequing" : "Credit Card", "Expense", vendor, 200 + i * 25, null, "Pending reconciliation"));
  }

  // Inconsistent categorization — same vendor on different accounts
  for (let month = 0; month < 6; month++) {
    const accs = ["Chequing", "Credit Card", "Accounts Payable"];
    list.push(tx(prefix, daysAgo(month * 30 + 10), accs[month % 3], "Expense", "Bell Canada", 450, month % 3 === 0 ? cheqBal - 450 : null, "Phone"));
    list.push(tx(prefix, daysAgo(month * 30 + 12), accs[(month + 1) % 3], "Expense", "Rogers", 89, null, "Internet"));
  }

  // 4 balance jumps > $5000 with no matching transaction
  const jumpDays = [40, 80, 160, 240];
  for (const day of jumpDays) {
    list.push(tx(prefix, daysAgo(day + 1), "Chequing", "Expense", VENDORS[0], 100, cheqBal, "Normal expense"));
    list.push(tx(prefix, daysAgo(day), "Chequing", "Expense", VENDORS[1], 200, cheqBal + 7200, "Normal expense"));
  }

  // Regular transactions to fill
  for (let month = 0; month < 12; month++) {
    const baseDay = month * 30;
    // Revenue
    list.push(tx(prefix, daysAgo(baseDay + 1), "Chequing", "Deposit", "Client Payments", 5000 + month * 300, cheqBal + 5000, "Monthly revenue"));
    // Regular expenses
    for (let v = 0; v < 6; v++) {
      const vendor = VENDORS[v];
      const amount = 150 + v * 40;
      list.push(tx(prefix, daysAgo(baseDay + 3 + v * 3), "Chequing", "Expense", vendor, amount, cheqBal - amount, `${vendor} monthly`));
    }
  }

  // Fill to 155
  while (list.length < 155) {
    const i = list.length;
    const day = 1 + (i % 340);
    const vendor = VENDORS[i % VENDORS.length];
    list.push(tx(prefix, daysAgo(day), "Chequing", "Expense", vendor, 100 + (i % 80), cheqBal - 100, "Operating expense"));
  }

  return list;
}

// ── Export Samples ─────────────────────────────────────────────────

export const messyFirm: SampleDefinition = {
  id: "maple",
  firmName: "Maple Advisory Group",
  description: "Messy books, high anomaly count",
  grade: "D",
  transactions: buildMapleTransactions(),
};

export const healthyFirm: SampleDefinition = {
  id: "cedar",
  firmName: "Cedar Table Restaurant",
  description: "Clean books, well-managed firm",
  grade: "A",
  transactions: buildCedarTransactions(),
};

export const acquisitionTarget: SampleDefinition = {
  id: "lakeview",
  firmName: "Lakeview Bookkeeping Co.",
  description: "Acquisition target with red flags",
  grade: "C",
  transactions: buildLakeviewTransactions(),
};

export const ALL_SAMPLES: SampleDefinition[] = [messyFirm, healthyFirm, acquisitionTarget];

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
