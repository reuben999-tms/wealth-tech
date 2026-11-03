# Wealth Tech Innovations – Business Logbook (Version 1)

Offline-first business logbook. Plain HTML, CSS and JavaScript. Data is stored in IndexedDB in your browser.

## Run it
1. Keep all files in one folder.
2. Service workers and "Install app" need `http://localhost` or HTTPS. Easiest: open the folder in a terminal and run `python -m http.server 8000`, then visit `http://localhost:8000`. (Opening `index.html` directly also works, but without offline caching or install.)
3. In Chrome/Edge, use the install icon in the address bar to install it as an app.

## Use it
- **Customers**: add first. Each customer has a history of repairs and purchases and an amount owed.
- **Repairs**: Receive device → update Status as work progresses (history is kept) → record Payments. Value, paid and balance are always shown separately.
- **Inventory**: add products (new categories appear automatically), adjust stock with a reason. Low-stock alerts show on the dashboard.
- **Sales**: pick a product, quantity and amount paid. Stock, sales totals and finance update automatically. Price changes never alter past sales.
- **Finance**: recorded value vs money actually received vs outstanding, plus expenses.
- **Back up data** regularly (downloads a JSON file). **Restore backup** replaces all records.

## Version 1 status
Implemented: dashboard, customers, repairs (10 statuses, history), sales, inventory with movement history, payments, expenses, audit log, backup/restore, online/offline indicator, PWA caching.

Not yet built (planned Versions 2–4): suppliers, warranty/returns, reports and print/export, tasks, employees and logins/roles, settings screens (categories, prices, statuses), cloud sync, receipts/QR codes, charts via Chart.js.

## Known limitations
- No login or roles yet. Anyone with access to the browser can see all data.
- No delete buttons by design: records are corrected through edits, adjustments or cancellation so history stays intact.
- Cloud sync is not built. Each record carries a `synced` flag and `updatedAt` so sync can be added later.
- Data lives in one browser on one device: back up often. Clearing browser data erases it unless you have a backup.
- Not yet tested in a browser by me; please test each module with a few records and report any problem.
