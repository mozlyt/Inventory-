# MOZLYT Inventory

Private stock, sales, money and savings app for the MOZLYT sales team, served at https://inventory.mozlyt.com.

- Installable web app: `index.html`, `app.css`, `app.js`, `manifest.webmanifest`, `sw.js`, `icons/`.
- Screens: Home, Stock (stock in, give to marketer, returns), Sell, Team (marketer pages), Money (owed, savings, profit, reports), Settings (products, targets, pay).
- Sign-in: Supabase Auth (email and password). The owner account is mozlyt0@gmail.com.
- Records: Supabase Postgres (project `mozlyt`, ref `cdhprjmonwaomxmfxraz`, London) through the Supabase Data API, protected by row-level security. Schema and migrations are in `supabase/`. Moved from Neon on 23 Nov 2026; the Neon project was deleted the same day.
- Every table has row-level security: only accounts listed in `app_owner` can read or change records.

No passwords or database keys are stored in this repository.
