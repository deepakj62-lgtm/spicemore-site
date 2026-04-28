// Single source of truth for the SEPL Cardamom Consignment Programme.
export default {
  standardAdvanceRate: 0.70,
  maxAdvanceRate: 0.75,
  annualHoldingRate: 0.219,
  daysBasis: 365,
  standardTenureDays: 90,
  maxTenureDays: 120,
  ltv: { yellow: 0.75, orange: 0.80, red: 0.85, forced: 0.90 },
  depots: ['Kumily', 'Kollaparachal'],
  auctionCommission: 0.01,
  gstOnCommission: 0.18,
  consignorTypes: ['Planter', 'Trader'],
  grades: ['AGEB', 'AGB', '8mm Bold', '7mm', '6mm', 'Mixed'],
  programme: 'SEPL Cardamom Consignment Programme',
  issuer: 'Spicemore Exim Pvt Ltd (SEPL)',
  auctioneer: 'Spice More Trading Company (Spicemore)'
};
