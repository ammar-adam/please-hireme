import type { QBOTransaction } from "./types";

export const SAMPLE_FIRM_NAME = "Sample Firm";

function daysAgo(days: number): Date {
  const d = new Date();
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
const TRANSACTION_TYPES = [
  "Invoice",
  "Bill",
  "Expense",
  "Deposit",
  "Journal Entry",
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

  // --- Normal transactions (baseline) ---
  const balanceCheq = 10000;

  // Chequing: add 2 consecutive same-balance with 8+ day gap for reconciliation lag
  list.push(
    tx(
      daysAgo(50),
      "Chequing",
      "Expense",
      "Office Depot",
      200,
      balanceCheq,
      "Supplies"
    )
  );
  list.push(
    tx(
      daysAgo(42),
      "Chequing",
      "Expense",
      "Slack",
      50,
      balanceCheq,
      "Subscription"
    )
  );
  list.push(
    tx(
      daysAgo(30),
      "Chequing",
      "Expense",
      "AWS",
      120,
      balanceCheq,
      "Hosting"
    )
  );
  list.push(
    tx(
      daysAgo(20),
      "Chequing",
      "Deposit",
      "Stripe",
      1500,
      balanceCheq + 1500,
      "Payment"
    )
  );

  // Credit Card: 1 pair same balance 15+ days apart
  list.push(
    tx(
      daysAgo(60),
      "Credit Card",
      "Expense",
      "Uber",
      45,
      -800,
      "Travel"
    )
  );
  list.push(
    tx(
      daysAgo(44),
      "Credit Card",
      "Expense",
      "FedEx",
      30,
      -800,
      "Shipping"
    )
  );

  // --- Duplicates: 6 pairs across ≥2 accounts ---
  const dupAmount1 = 199.99;
  const dupName1 = "Bell Canada";
  list.push(
    tx(daysAgo(10), "Chequing", "Bill", dupName1, dupAmount1, 9000, "Phone")
  );
  list.push(
    tx(daysAgo(8), "Chequing", "Bill", dupName1, dupAmount1, 9000, "Phone")
  );
  list.push(
    tx(daysAgo(15), "Chequing", "Expense", "WeWork", 350, 8650, "Rent")
  );
  list.push(
    tx(daysAgo(12), "Chequing", "Expense", "WeWork", 350, 8650, "Rent")
  );
  list.push(
    tx(daysAgo(22), "Accounts Payable", "Bill", "Rogers", 89, -3100, "Internet")
  );
  list.push(
    tx(daysAgo(20), "Accounts Payable", "Bill", "Rogers", 89, -3100, "Internet")
  );
  list.push(
    tx(daysAgo(35), "Credit Card", "Expense", "Shopify", 25, -850, "Fee")
  );
  list.push(
    tx(daysAgo(33), "Credit Card", "Expense", "Shopify", 25, -850, "Fee")
  );
  list.push(
    tx(daysAgo(48), "Accounts Receivable", "Invoice", "Client A", 500, 5500, "")
  );
  list.push(
    tx(daysAgo(46), "Accounts Receivable", "Invoice", "Client A", 500, 5500, "")
  );
  list.push(
    tx(daysAgo(65), "Chequing", "Expense", "Slack", 48, 8200, "Sub")
  );
  list.push(
    tx(daysAgo(63), "Chequing", "Expense", "Slack", 48, 8200, "Sub")
  );

  // --- Unreconciled: 11 items, balance null or 0, >30 days old, not Deposit, ≥2 accounts ---
  for (let i = 0; i < 6; i++) {
    list.push(
      tx(
        daysAgo(45 + i * 2),
        "Chequing",
        "Expense",
        VENDORS[i],
        100 + i * 10,
        null,
        "Old"
      )
    );
  }
  for (let i = 0; i < 5; i++) {
    list.push(
      tx(
        daysAgo(50 + i * 2),
        "Accounts Payable",
        "Bill",
        VENDORS[i + 2],
        80,
        null,
        "Old bill"
      )
    );
  }

  // --- Miscategorized: 3 blank name, 3 Uncategorized Expense, 2 blank memo + amount > 500 ---
  list.push(
    tx(daysAgo(7), "Chequing", "Expense", "", 75, 9100, "Misc")
  );
  list.push(
    tx(daysAgo(14), "Accounts Receivable", "Invoice", "", 200, 5200, "")
  );
  list.push(
    tx(daysAgo(28), "Credit Card", "Expense", "", 40, -820, "")
  );
  list.push(
    tx(
      daysAgo(11),
      "Uncategorized Expense",
      "Expense",
      "Office Depot",
      60,
      null,
      "Office"
    )
  );
  list.push(
    tx(
      daysAgo(19),
      "Uncategorized Expense",
      "Expense",
      "Uber",
      35,
      null,
      "Trip"
    )
  );
  list.push(
    tx(
      daysAgo(26),
      "Uncategorized Expense",
      "Expense",
      "FedEx",
      22,
      null,
      "Ship"
    )
  );
  list.push(
    tx(daysAgo(3), "Chequing", "Expense", "WeWork", 600, 8500, "")
  );
  list.push(
    tx(daysAgo(9), "Accounts Payable", "Bill", "AWS", 550, -3200, "")
  );

  // --- Fill to 60 with normal variety ---
  while (list.length < 60) {
    const day = 1 + (list.length % 80);
    const acc = ACCOUNTS[list.length % 4];
    const vendor = VENDORS[list.length % VENDORS.length];
    const type = TRANSACTION_TYPES[list.length % 5];
    const amt = (list.length % 2 === 0 ? 1 : -1) * (50 + list.length * 7);
    const bal = type === "Deposit" ? 5000 + list.length * 10 : null;
    list.push(
      tx(daysAgo(day), acc, type, vendor, Math.abs(amt), bal, "Note")
    );
  }

  return list.slice(0, 60);
})();
