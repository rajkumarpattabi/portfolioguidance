// Bundled stock -> sector map for PortfolioGuidance.
// Zerodha does not return an industry/sector for holdings, so we classify here.
// You can override/assign any stock in-app (Settings -> Sector map); your edits are
// saved on-device and win over this bundled default. Keyed by NSE tradingsymbol.

window.PG_SECTORS = {
  // sector list (order used for the legend / picker / colours)
  LIST: [
    "Fin-Banks", "Fin-NBFC", "Insurance", "Info Tech", "IT Hardware", "Pharma",
    "FMCG", "Automobiles", "Specialty Chemicals", "Paints", "Metals & Mining",
    "Capital Goods", "Power (Renewable)", "Gold", "Unclassified"
  ],

  MAP: {
    // Fin-Banks
    "HDFCBANK": "Fin-Banks", "KOTAKBANK": "Fin-Banks", "INDUSINDBK": "Fin-Banks",
    "IDFCFIRSTB": "Fin-Banks", "SOUTHBANK": "Fin-Banks", "KTKBANK": "Fin-Banks",
    // Fin-NBFC
    "BAJFINANCE": "Fin-NBFC", "JIOFIN": "Fin-NBFC", "SBICARD": "Fin-NBFC",
    "AAVAS": "Fin-NBFC", "MANAPPURAM": "Fin-NBFC", "MUTHOOTFIN": "Fin-NBFC",
    // Insurance
    "HDFCLIFE": "Insurance",
    // Info Tech
    "TCS": "Info Tech", "INFY": "Info Tech",
    // IT Hardware
    "CEREBRAINT": "IT Hardware",
    // Pharma
    "DRREDDY": "Pharma", "TORNTPHARM": "Pharma", "NATCOPHARM": "Pharma", "CAPLIPOINT": "Pharma",
    // FMCG
    "HINDUNILVR": "FMCG", "NESTLEIND": "FMCG", "ITC": "FMCG",
    // Automobiles
    "TMPV": "Automobiles", "TMCV": "Automobiles",
    // Specialty Chemicals
    "PIDILITIND": "Specialty Chemicals", "ANURAS": "Specialty Chemicals", "HSCL": "Specialty Chemicals",
    // Paints
    "ASIANPAINT": "Paints",
    // Metals & Mining
    "VEDL": "Metals & Mining",
    // Capital Goods
    "LT": "Capital Goods",
    // Power (Renewable)
    "SUZLON": "Power (Renewable)",
    // Gold
    "GOLDIETF": "Gold"
  }
};
