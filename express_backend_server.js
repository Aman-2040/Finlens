const express = require("express");
const cors = require("cors");
const path = require("path");

// ─── Load & normalize card data ───────────────────────────────────────────────
const fs = require("fs");

function normalizeCard(raw, defaultType) {
  // Map fields from india_credit_debit_cards_154.json → flat schema used by frontend
  const fees   = raw.fees   || {};
  const rewards = raw.rewards || {};
  const perks  = raw.perks  || {};
  const elig   = raw.eligibility || {};

  // Determine color based on tier
  const tierColorMap = {
    "Infinite": "#1a1a2e", "Signature": "#16213e", "Platinum": "#0a3d62",
    "Gold": "#b8860b", "Classic": "#2c3e50", "Basic": "#4a4a4a"
  };
  const tier = raw.tier || "Classic";
  const hasLounge = !!(perks.airport_lounge_access && perks.airport_lounge_access !== "None" && perks.airport_lounge_access !== "");
  const annualFee = fees.annual_fee || 0;

  return {
    id:          raw.card_id || raw.id || `card-${Math.random().toString(36).slice(2)}`,
    type:        (raw.card_type || defaultType || "Credit").toLowerCase(),
    bank:        raw.issuer  || raw.bank || "Unknown Bank",
    name:        raw.card_name || raw.name || "Card",
    tier:        tier,
    network:     raw.network || "Visa",
    annualFee:   annualFee,
    feeLabel:    annualFee === 0 ? "Free" : `₹${annualFee.toLocaleString("en-IN")}/yr`,
    minBalance:  elig.min_annual_income_inr || 0,
    atmLimit:    fees.atm_limit || 0,
    posLimit:    fees.pos_limit || 0,
    rewards:     rewards.reward_rate_percent || 1,
    lounge:      perks.airport_lounge_access || "None",
    hasLounge:   hasLounge,
    forex:       fees.foreign_transaction_markup_percent || 3.5,
    insurance:   perks.insurance || "None",
    hasInsurance: !!(perks.insurance && perks.insurance !== "None"),
    popular:     raw.popular || 0,
    beginner:    tier === "Basic" || tier === "Classic",
    color:       tierColorMap[tier] || "#2c3e50",
    summary:     rewards.summary || `${tier} ${(raw.card_type||"Credit")} Card by ${raw.issuer || ""}`,
    hasWaiver:   !!(fees.annual_fee_waiver_spend),
    waiverSpend: fees.annual_fee_waiver_spend || null,
    rates: {
      online:  (rewards.online_rate_percent  || rewards.reward_rate_percent || 1) / 100,
      dining:  (rewards.dining_rate_percent  || rewards.reward_rate_percent || 1) / 100,
      travel:  (rewards.travel_rate_percent  || rewards.reward_rate_percent || 1) / 100,
      utility: (rewards.utility_rate_percent || rewards.reward_rate_percent || 0.5) / 100,
      offline: (rewards.offline_rate_percent || rewards.reward_rate_percent || 0.5) / 100,
    }
  };
}

function normalizeLoan(raw, idx) {
  // Map fields from aura_wealth_indian_loan_database.json → flat schema
  // Helper: extract a fact value by field name
  const factVal = (field) => {
    const f = (raw.facts || []).find(x => x.field === field);
    return f ? f.value : null;
  };
  const factNorm = (field) => {
    const f = (raw.facts || []).find(x => x.field === field);
    return f && f.normalizedValue ? f.normalizedValue : null;
  };

  // Try to extract numeric interest rate
  let rateMin = null, rateMax = null;
  const rateNorm = factNorm("interestRate");
  if (rateNorm) {
    rateMin = rateNorm.minimumPercent || rateNorm.floorPercent || null;
    rateMax = rateNorm.maximumPercent || rateNorm.ceilingPercent || null;
  }
  if (!rateMin) {
    const rateStr = factVal("interestRate") || "";
    const nums = rateStr.match(/[\d.]+/g);
    if (nums && nums.length >= 2) { rateMin = parseFloat(nums[0]); rateMax = parseFloat(nums[1]); }
    else if (nums && nums.length === 1) { rateMin = rateMax = parseFloat(nums[0]); }
  }

  // Category from loanType fact
  const loanType = factVal("loanType") || raw.name || "";
  let category = "Personal Loan";
  const lt = loanType.toLowerCase();
  if (lt.includes("home") || lt.includes("housing"))  category = "Home Loan";
  else if (lt.includes("vehicle") || lt.includes("car") || lt.includes("auto")) category = "Auto Loan";
  else if (lt.includes("education") || lt.includes("student")) category = "Education Loan";
  else if (lt.includes("gold"))  category = "Gold Loan";
  else if (lt.includes("business") || lt.includes("msme")) category = "Business Loan";
  else if (lt.includes("personal")) category = "Personal Loan";

  // Processing fee
  let feePct = 1;
  const feeNorm = factNorm("processingFee");
  if (feeNorm && feeNorm.maximumPercent) feePct = feeNorm.maximumPercent;

  // Bank name from raw.bankId or catalogue
  const lender = (raw.catalogueRecord && raw.catalogueRecord.name)
    ? raw.catalogueRecord.name
    : raw.name || `Loan ${idx + 1}`;
  const bankName = raw.bankId
    ? raw.bankId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : lender;

  return {
    id:        raw.id || `loan-${idx}`,
    category,
    lender:    `${bankName} (${lender})`,
    rateMin:   rateMin || 8.5,
    rateMax:   rateMax || 18.0,
    minCibil:  700,
    feePct,
    prepayPct: 0,
    days:      5,
    popular:   raw.cataloguePosition ? Math.max(0, 100 - raw.cataloguePosition) : 50,
    summary:   raw.summary || loanType,
    officialUrl: raw.officialUrl || null
  };
}

let cardsData = [];
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "india_credit_debit_cards_154.json"), "utf8"));
  const creditCards = (raw.credit_cards || []).map(c => normalizeCard(c, "Credit"));
  const debitCards  = (raw.debit_cards  || []).map(c => normalizeCard(c, "Debit"));
  cardsData = [...creditCards, ...debitCards];
  console.log(`Loaded ${cardsData.length} cards from india_credit_debit_cards_154.json`);
} catch (e) {
  console.warn("Failed to load new card JSON, using fallback cards.json:", e.message);
  cardsData = require("./data/cards.json");
}

let offersData = [];
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "aura_wealth_indian_loan_database.json"), "utf8"));
  offersData = (raw.products || []).map((p, i) => normalizeLoan(p, i));
  console.log(`Loaded ${offersData.length} loan offers from aura_wealth_indian_loan_database.json`);
} catch (e) {
  console.warn("Failed to load new loan JSON, using fallback loan-offers.json:", e.message);
  offersData = require("./data/loan-offers.json");
}

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_FILE = path.join(
  __dirname,
  "finlens_financial_product_discovery_loan_affordability_platform.html"
);

app.use(cors());
app.use(express.json());

// Serve the frontend app at /, /index.html, and its original filename
app.get(["/", "/index.html", "/finlens_financial_product_discovery_loan_affordability_platform.html"], (req, res) => {
  res.sendFile(FRONTEND_FILE);
});

// 1. Health & Disclaimer Endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    mode: "published-schedules",
    disclaimer: "Indicative figures based on published bank and lender schedules. Not connected to live credit bureaus."
  });
});

// 2. Get Debit & Credit Cards (supports ?type=debit or ?type=credit and ?tier=Basic)
app.get("/api/cards", (req, res) => {
  const { type, tier } = req.query;
  let results = cardsData;

  if (type) {
    results = results.filter(c => (c.type || "").toLowerCase() === String(type).toLowerCase());
  }
  if (tier) {
    results = results.filter(c => (c.tier || "").toLowerCase() === String(tier).toLowerCase());
  }

  res.json({
    source: "published-bank-schedules",
    count: results.length,
    cards: results
  });
});

// 3. Get Loan Offers (supports ?category=Auto%20Loan)
app.get("/api/loan-offers", (req, res) => {
  const { category } = req.query;
  let results = offersData;

  if (category) {
    results = results.filter(o => (o.category || "").toLowerCase() === String(category).toLowerCase());
  }

  res.json({
    source: "published-lender-schedules",
    count: results.length,
    offers: results
  });
});

// 4. Card Recommendation & Savings Estimation Endpoint
app.post("/api/suggest-cards", (req, res) => {
  const body = req.body || {};
  const rawSpend = body.spend || {};
  const spend = {
    online: Math.max(0, Number(rawSpend.online) || 0),
    dining: Math.max(0, Number(rawSpend.dining) || 0),
    travel: Math.max(0, Number(rawSpend.travel) || 0),
    utility: Math.max(0, Number(rawSpend.utility) || 0),
    offline: Math.max(0, Number(rawSpend.offline) || 0)
  };
  const typeFilter = body.type && body.type !== "all" ? String(body.type).toLowerCase() : null;

  const monthlySpend = spend.online + spend.dining + spend.travel + spend.utility + spend.offline;
  const annualSpend = monthlySpend * 12;

  const pool = typeFilter
    ? cardsData.filter(c => (c.type || "").toLowerCase() === typeFilter)
    : cardsData;

  const suggestions = pool.map(card => {
    const rates = card.rates || {};
    const fallbackRate = (Number(card.rewards) || 0) / 100;
    const categoryAnnual = {
      online: Math.round(spend.online * 12 * (rates.online ?? fallbackRate)),
      dining: Math.round(spend.dining * 12 * (rates.dining ?? fallbackRate)),
      travel: Math.round(spend.travel * 12 * (rates.travel ?? fallbackRate)),
      utility: Math.round(spend.utility * 12 * (rates.utility ?? fallbackRate)),
      offline: Math.round(spend.offline * 12 * (rates.offline ?? fallbackRate))
    };
    const grossAnnualRewards = Object.values(categoryAnnual).reduce((a, b) => a + b, 0);
    const feeWaived = card.annualFee > 0 && Boolean(card.hasWaiver) && card.waiverSpend != null && annualSpend >= card.waiverSpend;
    const effectiveFee = card.annualFee === 0 || feeWaived ? 0 : card.annualFee;
    const netAnnualSavings = grossAnnualRewards - effectiveFee;

    return {
      ...card,
      grossAnnualRewards,
      effectiveFee,
      feeWaived,
      netAnnualSavings,
      netMonthlySavings: Math.round(netAnnualSavings / 12),
      categoryAnnual
    };
  }).sort((a, b) => b.netAnnualSavings - a.netAnnualSavings || b.popular - a.popular);

  res.json({
    cardSpendMonthly: monthlySpend,
    cardSpendAnnual: annualSpend,
    count: suggestions.length,
    suggestions
  });
});

// 5. Server-side EMI & Affordability Calculation Endpoint
app.post("/api/calculate-affordability", (req, res) => {
  const body = req.body || {};
  const income = Number(body.income) || 0;
  const expenses = Math.max(0, Number(body.expenses) || 0);
  const existingEmis = Math.max(0, Number(body.existingEmis) || 0);
  const proposedEmi = Math.max(0, Number(body.proposedEmi) || 0);

  if (income <= 0) {
    return res.status(400).json({ error: "Monthly income must be greater than zero." });
  }

  const foir = ((existingEmis + proposedEmi) / income) * 100;
  const disposable = income - expenses - existingEmis - proposedEmi;
  const leftPct = (disposable / income) * 100;

  let verdict = "Good";
  if (foir > 55 || leftPct < 5 || disposable <= 0) verdict = "Not Recommended";
  else if (foir > 45 || leftPct < 10) verdict = "Risky";
  else if (foir > 35 || leftPct < 20) verdict = "Manageable";

  res.json({
    foir: Number(foir.toFixed(1)),
    disposable: Math.round(disposable),
    leftPct: Number(leftPct.toFixed(1)),
    verdict,
    disclaimer: "Automated estimate based on self-reported figures."
  });
});

app.listen(PORT, () => {
  console.log(`FinLens server running at http://localhost:${PORT}`);
});