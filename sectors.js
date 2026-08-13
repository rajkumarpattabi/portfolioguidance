// Bundled stock -> sector map for PortfolioGuidance.
// Zerodha does not return an industry/sector for holdings, so we classify here.
// Sectors follow the taxonomy in methodology-v2.md. You can override/assign any
// stock in-app (Settings -> Sector map); your edits are saved on-device and win
// over this bundled default. Keyed by NSE tradingsymbol (as Zerodha reports it).

window.PG_SECTORS = {
  // canonical sector list (order used in the editor / legend)
  LIST: [
    "Private Banks", "PSU Banks", "NBFC / HFC", "Insurance", "AMC / Capital Markets",
    "FMCG", "Consumer / Retail", "IT Services", "Pharma", "Specialty Chemicals",
    "Metals & Mining", "Auto & Ancillaries", "Capital Goods", "Defence",
    "Renewables / Utilities", "Cement", "Telecom", "Real Estate", "Oil & Gas / Energy",
    "Hospitals & Diagnostics", "EMS / Electronics", "Paints / Building Materials",
    "Agri / Fertilizers", "Infrastructure", "Conglomerate", "Unclassified"
  ],

  MAP: {
    // Private Banks
    "HDFCBANK":"Private Banks","ICICIBANK":"Private Banks","AXISBANK":"Private Banks",
    "KOTAKBANK":"Private Banks","INDUSINDBK":"Private Banks","IDFCFIRSTB":"Private Banks",
    "FEDERALBNK":"Private Banks","RBLBANK":"Private Banks","BANDHANBNK":"Private Banks",
    "CITYUNIONBK":"Private Banks","AUBANK":"Private Banks","YESBANK":"Private Banks",
    // PSU Banks
    "SBIN":"PSU Banks","BANKBARODA":"PSU Banks","PNB":"PSU Banks","CANBK":"PSU Banks",
    "UNIONBANK":"PSU Banks","INDIANB":"PSU Banks","BANKINDIA":"PSU Banks","IOB":"PSU Banks",
    // NBFC / HFC
    "BAJFINANCE":"NBFC / HFC","BAJAJFINSV":"NBFC / HFC","CHOLAFIN":"NBFC / HFC",
    "SHRIRAMFIN":"NBFC / HFC","MUTHOOTFIN":"NBFC / HFC","LICHSGFIN":"NBFC / HFC",
    "PFC":"NBFC / HFC","RECLTD":"NBFC / HFC","M&MFIN":"NBFC / HFC","SBICARD":"NBFC / HFC",
    "IREDA":"NBFC / HFC","POONAWALLA":"NBFC / HFC","CANFINHOME":"NBFC / HFC",
    // Insurance
    "SBILIFE":"Insurance","HDFCLIFE":"Insurance","ICICIPRULI":"Insurance",
    "ICICIGI":"Insurance","LICI":"Insurance","MAXHEALTH":"Insurance","STARHEALTH":"Insurance",
    // AMC / Capital Markets
    "HDFCAMC":"AMC / Capital Markets","NUVAMA":"AMC / Capital Markets","BSE":"AMC / Capital Markets",
    "CDSL":"AMC / Capital Markets","MCX":"AMC / Capital Markets","ANGELONE":"AMC / Capital Markets",
    "CAMS":"AMC / Capital Markets","360ONE":"AMC / Capital Markets","KFINTECH":"AMC / Capital Markets",
    // FMCG
    "HINDUNILVR":"FMCG","ITC":"FMCG","NESTLEIND":"FMCG","BRITANNIA":"FMCG","DABUR":"FMCG",
    "MARICO":"FMCG","GODREJCP":"FMCG","COLPAL":"FMCG","TATACONSUM":"FMCG","VBL":"FMCG",
    "UBL":"FMCG","RADICO":"FMCG","EMAMILTD":"FMCG","PGHH":"FMCG","JYOTHYLAB":"FMCG",
    // Consumer / Retail
    "TITAN":"Consumer / Retail","DMART":"Consumer / Retail","TRENT":"Consumer / Retail",
    "ZOMATO":"Consumer / Retail","ETERNAL":"Consumer / Retail","NYKAA":"Consumer / Retail",
    "FSN":"Consumer / Retail","JUBLFOOD":"Consumer / Retail","DEVYANI":"Consumer / Retail",
    "PAGEIND":"Consumer / Retail","BATAINDIA":"Consumer / Retail","RELAXO":"Consumer / Retail",
    "ABFRL":"Consumer / Retail","VMART":"Consumer / Retail","METROBRAND":"Consumer / Retail",
    // IT Services
    "TCS":"IT Services","INFY":"IT Services","WIPRO":"IT Services","HCLTECH":"IT Services",
    "TECHM":"IT Services","LTIM":"IT Services","PERSISTENT":"IT Services","COFORGE":"IT Services",
    "MPHASIS":"IT Services","LTTS":"IT Services","KPITTECH":"IT Services","TATAELXSI":"IT Services",
    "OFSS":"IT Services","BSOFT":"IT Services","CYIENT":"IT Services",
    // Pharma
    "SUNPHARMA":"Pharma","DRREDDY":"Pharma","CIPLA":"Pharma","DIVISLAB":"Pharma",
    "LUPIN":"Pharma","AUROPHARMA":"Pharma","ZYDUSLIFE":"Pharma","ALKEM":"Pharma",
    "TORNTPHARM":"Pharma","BIOCON":"Pharma","MANKIND":"Pharma","GLENMARK":"Pharma",
    "LAURUSLABS":"Pharma","IPCALAB":"Pharma","ABBOTINDIA":"Pharma",
    // Specialty Chemicals
    "PIIND":"Specialty Chemicals","SRF":"Specialty Chemicals","AARTIIND":"Specialty Chemicals",
    "DEEPAKNTR":"Specialty Chemicals","NAVINFLUOR":"Specialty Chemicals","ATUL":"Specialty Chemicals",
    "VINATIORGA":"Specialty Chemicals","FLUOROCHEM":"Specialty Chemicals","TATACHEM":"Specialty Chemicals",
    "UPL":"Specialty Chemicals","CLEAN":"Specialty Chemicals","ALKYLAMINE":"Specialty Chemicals",
    // Metals & Mining
    "TATASTEEL":"Metals & Mining","JSWSTEEL":"Metals & Mining","HINDALCO":"Metals & Mining",
    "VEDL":"Metals & Mining","COALINDIA":"Metals & Mining","NMDC":"Metals & Mining",
    "SAIL":"Metals & Mining","JINDALSTEL":"Metals & Mining","HINDZINC":"Metals & Mining",
    "NATIONALUM":"Metals & Mining","APLAPOLLO":"Metals & Mining","HINDCOPPER":"Metals & Mining",
    // Auto & Ancillaries
    "MARUTI":"Auto & Ancillaries","M&M":"Auto & Ancillaries","TATAMOTORS":"Auto & Ancillaries",
    "BAJAJ-AUTO":"Auto & Ancillaries","EICHERMOT":"Auto & Ancillaries","HEROMOTOCO":"Auto & Ancillaries",
    "TVSMOTOR":"Auto & Ancillaries","ASHOKLEY":"Auto & Ancillaries","BOSCHLTD":"Auto & Ancillaries",
    "MOTHERSON":"Auto & Ancillaries","BALKRISIND":"Auto & Ancillaries","MRF":"Auto & Ancillaries",
    "TIINDIA":"Auto & Ancillaries","BHARATFORG":"Auto & Ancillaries","EXIDEIND":"Auto & Ancillaries",
    "UNOMINDA":"Auto & Ancillaries","SONACOMS":"Auto & Ancillaries","ENDURANCE":"Auto & Ancillaries",
    // Capital Goods
    "LT":"Capital Goods","SIEMENS":"Capital Goods","ABB":"Capital Goods","BHEL":"Capital Goods",
    "CGPOWER":"Capital Goods","THERMAX":"Capital Goods","CUMMINSIND":"Capital Goods",
    "HAVELLS":"Capital Goods","POLYCAB":"Capital Goods","KEI":"Capital Goods","AIAENG":"Capital Goods",
    "GRINDWELL":"Capital Goods","TIMKEN":"Capital Goods","SKFINDIA":"Capital Goods","KAYNES":"Capital Goods",
    // Defence
    "HAL":"Defence","BEL":"Defence","BDL":"Defence","MAZDOCK":"Defence","COCHINSHIP":"Defence",
    "BEML":"Defence","DATAPATTNS":"Defence","GRSE":"Defence","MIDHANI":"Defence","PARAS":"Defence",
    // Renewables / Utilities
    "NTPC":"Renewables / Utilities","POWERGRID":"Renewables / Utilities","TATAPOWER":"Renewables / Utilities",
    "ADANIGREEN":"Renewables / Utilities","ADANIENSOL":"Renewables / Utilities","JSWENERGY":"Renewables / Utilities",
    "NHPC":"Renewables / Utilities","SJVN":"Renewables / Utilities","TORNTPOWER":"Renewables / Utilities",
    "SUZLON":"Renewables / Utilities","INOXWIND":"Renewables / Utilities","CESC":"Renewables / Utilities",
    // Cement
    "ULTRACEMCO":"Cement","SHREECEM":"Cement","AMBUJACEM":"Cement","ACC":"Cement",
    "DALBHARAT":"Cement","JKCEMENT":"Cement","RAMCOCEM":"Cement","NUVOCO":"Cement","JKLAKSHMI":"Cement",
    // Telecom
    "BHARTIARTL":"Telecom","IDEA":"Telecom","INDUSTOWER":"Telecom","TATACOMM":"Telecom","HFCL":"Telecom",
    // Real Estate
    "DLF":"Real Estate","GODREJPROP":"Real Estate","OBEROIRLTY":"Real Estate","LODHA":"Real Estate",
    "MACROTECH":"Real Estate","PRESTIGE":"Real Estate","PHOENIXLTD":"Real Estate","BRIGADE":"Real Estate",
    "SOBHA":"Real Estate","NBCC":"Real Estate",
    // Oil & Gas / Energy
    "RELIANCE":"Oil & Gas / Energy","ONGC":"Oil & Gas / Energy","IOC":"Oil & Gas / Energy",
    "BPCL":"Oil & Gas / Energy","HINDPETRO":"Oil & Gas / Energy","GAIL":"Oil & Gas / Energy",
    "OIL":"Oil & Gas / Energy","IGL":"Oil & Gas / Energy","MGL":"Oil & Gas / Energy",
    "PETRONET":"Oil & Gas / Energy","GUJGASLTD":"Oil & Gas / Energy","ATGL":"Oil & Gas / Energy",
    "ADANIENT":"Oil & Gas / Energy",
    // Hospitals & Diagnostics
    "APOLLOHOSP":"Hospitals & Diagnostics","FORTIS":"Hospitals & Diagnostics","MAXHEALTHCARE":"Hospitals & Diagnostics",
    "DRLALPATHLAB":"Hospitals & Diagnostics","METROPOLIS":"Hospitals & Diagnostics","NH":"Hospitals & Diagnostics",
    "SYNGENE":"Hospitals & Diagnostics","KIMS":"Hospitals & Diagnostics","MEDANTA":"Hospitals & Diagnostics",
    // EMS / Electronics
    "DIXON":"EMS / Electronics","AMBER":"EMS / Electronics","KAYNESTECH":"EMS / Electronics",
    "SYRMA":"EMS / Electronics","CGCEL":"EMS / Electronics","VOLTAS":"EMS / Electronics",
    "BLUESTARCO":"EMS / Electronics","WHIRLPOOL":"EMS / Electronics","HONAUT":"EMS / Electronics",
    // Paints / Building Materials
    "ASIANPAINT":"Paints / Building Materials","BERGEPAINT":"Paints / Building Materials",
    "KANSAINER":"Paints / Building Materials","PIDILITIND":"Paints / Building Materials",
    "ASTRAL":"Paints / Building Materials","SUPREMEIND":"Paints / Building Materials",
    "KAJARIACER":"Paints / Building Materials","CENTURYPLY":"Paints / Building Materials",
    "FINPIPE":"Paints / Building Materials","PRINCEPIPE":"Paints / Building Materials",
    // Agri / Fertilizers
    "UPLLTD":"Agri / Fertilizers","COROMANDEL":"Agri / Fertilizers","CHAMBLFERT":"Agri / Fertilizers",
    "GNFC":"Agri / Fertilizers","RALLIS":"Agri / Fertilizers","KRIBHCO":"Agri / Fertilizers",
    "PIINDUSTRIES":"Agri / Fertilizers","BAYERCROP":"Agri / Fertilizers","GSFC":"Agri / Fertilizers",
    // Infrastructure
    "ADANIPORTS":"Infrastructure","GMRAIRPORT":"Infrastructure","IRB":"Infrastructure",
    "KEC":"Infrastructure","KALPATPOWR":"Infrastructure","RVNL":"Infrastructure","IRCON":"Infrastructure",
    "NCC":"Infrastructure","PNCINFRA":"Infrastructure","GRINFRA":"Infrastructure",
    "IRFC":"Infrastructure","IRCTC":"Infrastructure","CONCOR":"Infrastructure",
    // Conglomerate
    "GRASIM":"Conglomerate","ABCAPITAL":"Conglomerate","BAJAJHLDNG":"Conglomerate"
  }
};
