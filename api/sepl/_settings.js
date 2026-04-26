// EDWIN-Q: admin UI to edit these later — Phase 4
// Single source of truth for the SEPL Cardamom Consignment Programme.
// All other files MUST read from this module rather than hard-coding values.

module.exports = {
  // Advance / finance
  standardAdvanceRate: 0.65,     // 65%
  maxAdvanceRate: 0.70,          // hard cap
  annualHoldingRate: 0.219,      // 21.9% p.a. = Rs60 per Rs1,00,000 advance per day (Edwin's standard)
  daysBasis: 365,

  // Tenure
  standardTenureDays: 90,
  maxTenureDays: 120,

  // LTV thresholds (loan-to-value)
  ltv: {
    yellow: 0.75,   // monitor
    orange: 0.80,   // margin call
    red: 0.85,      // sell with 48h notice
    forced: 0.90    // immediate sale
  },

  // Depots
  depots: ['Kumily', 'Kollaparachal'],

  // Exit / auction
  auctionCommission: 0.01,  // 1%
  gstOnCommission: 0.18,    // 18%

  // Consignor types
  consignorTypes: ['Planter', 'Trader'],

  // Grades
  grades: ['AGEB', 'AGB', '8mm Bold', '7mm', '6mm', 'Mixed'],

  // Programme
  programme: 'SEPL Cardamom Consignment Programme',
  issuer: 'Spicemore Exim Pvt Ltd (SEPL)',
  auctioneer: 'Spice More Trading Company (SMTC)'
};
