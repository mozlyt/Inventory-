# MOZLYT Inventory

Private sales and savings dashboard for MOZLYT marketers, served at https://inventory.mozlyt.com.

- One static page (`index.html`) hosted on GitHub Pages.
- Sign-in: Neon Auth (email and password).
- Records: Neon Postgres (project `mozlyt-sales`, database `mozlyt`), reached through the Neon Data API.
- Every table has row-level security: only accounts listed in `app_owner` can read or change records. Other accounts can sign in but see nothing.

No passwords or database keys are stored in this repository.
