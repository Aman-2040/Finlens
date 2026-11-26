const express = require("express");
const cors = require("cors");
const path = require("path");

// Load card data: try new JSON file, fallback to existing data file
const fs = require("fs");
let cardsData = [];
try {
  const newCardsPath = path.join(__dirname, "india_credit_debit_cards_154.json");
  cardsData = JSON.parse(fs.readFileSync(newCardsPath, "utf8"));
  console.log("Loaded card data from india_credit_debit_cards_154.json");
} catch (e) {
  console.warn("Failed to load new card JSON, using fallback cards.json");
  cardsData = require("./data/cards.json");
}
// Load loan data: try new JSON file, fallback to existing data file
let offersData = [];
try {
  const newLoanPath = path.join(__dirname, "aura_wealth_indian_loan_database.json");
  offersData = JSON.parse(fs.readFileSync(newLoanPath, "utf8"));
  console.log("Loaded loan data from aura_wealth_indian_loan_database.json");
} catch (e) {
  console.warn("Failed to load new loan JSON, using fallback loan-offers.json");
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