import type { QBOTransaction } from "./types";

export const SAMPLE_FIRM_NAME = "Maple Ridge Accounting Co.";

const refEnd = new Date();
refEnd.setDate(refEnd.getDate() - 0);

function daysAgo(days: number): Date {
  const d = new Date(refEnd);
  d.setDate(d.getDate() - days);
  return d;
}

const ACCOUNTS = [
  "Chequing",
  "Accounts Receivable",
  "Accounts Payable",
  "Credit Card",
] as const;
const VENDORS = [
  "Bell Canada",
  "WeWork",
  "Stripe",
  "Shopify",
  "Office Depot",
  "Slack",
  "AWS",
  "Uber",
  "FedEx",
  "Rogers",
];

function tx(
  date: Date,
  account: string,
  type: string,
  name: string,
  amount: number,
  balance: number | null,
  memo: string = "Sample memo"
): QBOTransaction {
  return {
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

export const SAMPLE_TRANSACTIONS: QBOTransaction[] = (() => {
  const list: QBOTransaction[] = [];
  const balanceCheq = 10000;

  // --- Reconciliation lag: Chequing 2 consecutive same-balance 9 days apart ---
  list.push(tx(daysAgo(50), "Chequing", "Expense", "Office Depot", 200, balanceCheq, "Supplies"));
  list.push(tx(daysAgo(41), "Chequing", "Expense", "Slack", 50, balanceCheq, "Subscription"));
  list.push(tx(daysAgo(30), "Chequing", "Deposit", "Stripe", 1500, balanceCheq + 1250, "Payment"));

  // --- Credit Card: 1 pair same balance 16 days apart ---
  list.push(tx(daysAgo(70), "Credit Card", "Expense", "Uber", 45, -800, "Travel"));
  list.push(tx(daysAgo(54), "Credit Card", "Expense", "FedEx", 30, -800, "Shipping"));

  // --- Duplicates: 6 pairs across Chequing and Accounts Payable ---
  list.push(tx(daysAgo(10), "Chequing", "Bill", "Bell Canada", 199.99, 9000, "Phone"));
  list.push(tx(daysAgo(8), "Chequing", "Bill", "Bell Canada", 199.99, 9000, "Phone"));
  list.push(tx(daysAgo(15), "Chequing", "Expense", "WeWork", 350, 8650, "Rent"));
  list.push(tx(daysAgo(12), "Chequing", "Expense", "WeWork", 350, 8650, "Rent"));
  list.push(tx(daysAgo(22), "Chequing", "Expense", "Slack", 48, 8200, "Sub"));
  list.push(tx(daysAgo(20), "Chequing", "Expense", "Slack", 48, 8200, "Sub"));
  list.push(tx(daysAgo(35), "Accounts Payable", "Bill", "Rogers", 89, -3100, "Internet"));
  list.push(tx(daysAgo(33), "Accounts Payable", "Bill", "Rogers", 89, -3100, "Internet"));
  list.push(tx(daysAgo(45), "Accounts Payable", "Bill", "Office Depot", 120, -3200, "Supplies"));
  list.push(tx(daysAgo(43), "Accounts Payable", "Bill", "Office Depot", 120, -3200, "Supplies"));
  list.push(tx(daysAgo(55), "Accounts Payable", "Bill", "AWS", 200, -3400, "Hosting"));
  list.push(tx(daysAgo(53), "Accounts Payable", "Bill", "AWS", 200, -3400, "Hosting"));

  // --- Unreconciled: 11 items (balance null, >30 days old, not Deposit) ---
  for (let i = 0; i < 6; i++) {
    list.push(tx(daysAgo(45 + i * 2), "Chequing", "Expense", VENDORS[i], 100 + i * 10, null, "Old"));
  }
  for (let i = 0; i < 5; i++) {
    list.push(tx(daysAgo(50 + i * 2), "Accounts Payable", "Bill", VENDORS[i + 2], 80, null, "Old bill"));
  }

  // --- Miscategorized: 5 Uncategorized Expense + 3 blank name amount > 500 ---
  list.push(tx(daysAgo(11), "Uncategorized Expense", "Expense", "Office Depot", 60, null, "Office"));
  list.push(tx(daysAgo(19), "Uncategorized Expense", "Expense", "Uber", 35, null, "Trip"));
  list.push(tx(daysAgo(26), "Uncategorized Expense", "Expense", "FedEx", 22, null, "Ship"));
  list.push(tx(daysAgo(32), "Uncategorized Expense", "Expense", "Slack", 48, null, "Sub"));
  list.push(tx(daysAgo(38), "Uncategorized Expense", "Expense", "Shopify", 25, null, "Fee"));
  list.push(tx(daysAgo(3), "Chequing", "Expense", "", 600, 8500, ""));
  list.push(tx(daysAgo(9), "Accounts Payable", "Bill", "", 550, -3200, ""));
  list.push(tx(daysAgo(17), "Credit Card", "Expense", "", 750, -830, ""));

  // --- Ghost: 3 with blank name AND blank memo ---
  list.push(tx(daysAgo(5), "Chequing", "Expense", "", 100, 8900, ""));
  list.push(tx(daysAgo(14), "Accounts Receivable", "Invoice", "", 250, 5200, ""));
  list.push(tx(daysAgo(28), "Credit Card", "Expense", "", 40, -820, ""));

  // --- AP aging: 4 Bills in AP >60 days, null balance ---
  list.push(tx(daysAgo(75), "Accounts Payable", "Bill", "Bell Canada", 199, null, "Phone"));
  list.push(tx(daysAgo(82), "Accounts Payable", "Bill", "WeWork", 350, null, "Rent"));
  list.push(tx(daysAgo(88), "Accounts Payable", "Bill", "Rogers", 89, null, "Internet"));
  list.push(tx(daysAgo(85), "Accounts Payable", "Bill", "Office Depot", 120, null, "Supplies"));

  // --- AR aging: 3 Invoices in AR >90 days, null balance ---
  list.push(tx(daysAgo(95), "Accounts Receivable", "Invoice", "Client A", 500, null, ""));
  list.push(tx(daysAgo(100), "Accounts Receivable", "Invoice", "Client B", 750, null, ""));
  list.push(tx(daysAgo(92), "Accounts Receivable", "Invoice", "Client C", 300, null, ""));

  // --- Round numbers: 6 expense txns — 500, 1000, 1500, 2000, 750, 2500 ---
  list.push(tx(daysAgo(7), "Chequing", "Expense", "Vendor X", 500, 9100, "Estimate"));
  list.push(tx(daysAgo(16), "Chequing", "Expense", "Vendor Y", 1000, 8100, "Estimate"));
  list.push(tx(daysAgo(24), "Accounts Payable", "Bill", "Vendor Z", 1500, -3600, "Estimate"));
  list.push(tx(daysAgo(40), "Credit Card", "Expense", "Vendor W", 2000, -900, "Estimate"));
  list.push(tx(daysAgo(48), "Chequing", "Expense", "Vendor V", 750, 7350, "Estimate"));
  list.push(tx(daysAgo(60), "Accounts Payable", "Bill", "Vendor U", 2500, -5900, "Estimate"));

  // --- Fill to 60 with normal variety ---
  while (list.length < 60) {
    const day = 1 + (list.length % 80);
    const acc = ACCOUNTS[list.length % 4];
    const vendor = VENDORS[list.length % VENDORS.length];
    const type = list.length % 5 === 0 ? "Deposit" : list.length % 5 === 1 ? "Invoice" : list.length % 5 === 2 ? "Bill" : "Expense";
    const amt = type === "Deposit" ? 500 + list.length * 20 : -(50 + list.length * 7);
    const bal = type === "Deposit" ? 5000 + list.length * 10 : null;
    list.push(tx(daysAgo(day), acc, type, vendor, Math.abs(amt), bal, "Note"));
  }

  return list.slice(0, 60);
})();
