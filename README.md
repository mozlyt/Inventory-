# MOZLYT Inventory

Private stock, sales, money and savings app for the MOZLYT sales team, served at https://inventory.mozlyt.com.

- Installable web app: `index.html`, `app.css`, `app.js`, `manifest.webmanifest`, `sw.js`, `icons/`.
- Screens: Home, Stock (stock in, give to marketer, returns), Sell, Team (marketer pages), Money (owed, savings, profit, reports), Settings (products, targets, pay).
- Sign-in: Neon Auth (email and password). New sign-ups are switched off.
- Records: Neon Postgres (project `mozlyt-sales`, database `mozlyt`) through the Neon Data API.
- Every table has row-level security: only accounts listed in `app_owner` can read or change records.

No passwords or database keys are stored in this repository.
