// PortfolioGuidance configuration.
// NOTHING here is a secret. Your Zerodha API SECRET lives ONLY in the Cloudflare
// Worker (as an encrypted Worker secret), never in this repo and never on the phone.
//
// WORKER_URL: the base URL of your deployed Cloudflare Worker.
// Leave it blank to run the app in demo mode (sample holdings, no Zerodha).
window.PG_CONFIG = {
  WORKER_URL: "https://portfolioguidance.rajkumar-com.workers.dev"
};
