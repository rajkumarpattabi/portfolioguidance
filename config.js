// PortfolioGuidance configuration.
// NOTHING here is a secret. Your Zerodha API SECRET lives ONLY in the Cloudflare
// Worker (as an encrypted Worker secret), never in this repo and never on the phone.
//
// WORKER_URL: the base URL of your deployed Cloudflare Worker.
// GOOGLE_CLIENT_ID: OAuth Web client ID for Google Drive backup (optional).
//   A client-side OAuth client ID is NOT a secret — it is protected by the
//   "Authorised JavaScript origins" you set on it in Google Cloud Console.
//   Leave blank to hide the Drive-backup option.
window.PG_CONFIG = {
  WORKER_URL: "https://portfolioguidance.rajkumar-com.workers.dev",
  GOOGLE_CLIENT_ID: "715680116797-smju59t38hpmr376dvsu3nv8g1kna7h1.apps.googleusercontent.com"
};
