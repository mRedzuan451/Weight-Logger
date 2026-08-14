# Weight Logger Web App

A lightweight warehouse tool for scanning stock packets, recording their weights, and tracking stock-in/out transactions. The application runs entirely in the browser, stores data in `localStorage`, and offers offline access via a Progressive Web App (PWA) setup.

## Features

- **Stock In:** Connect to a digital scale via the Web Serial API, scan packet QR/Barcode codes, lock measured weights, and save records locally.
- **Stock Out:** Reuse scanned packet data to remove weight, auto-calculate remaining quantities and pieces, and export CSV logs.
- **Admin Dashboard:** View combined Stock In/Out history, filter by date range, and export data.
- **Role Awareness:** Login required for access, with admin-only pages restricted by the signed-in user's role.
- **Data Retention:** Automatically prunes stock records older than 60 days.
- **Offline Ready:** Manifest and service worker cache the app shell for installation and offline usage.

## Project Structure

```
Weight Logger/
├─ index.html                # Stock in page
├─ stock-out.html            # Stock out workflow
├─ stock-out-records.html    # Stock out history list
├─ menu.html                 # Navigation hub
├─ login.html                # Authentication
├─ admin.html                # Combined history dashboard
├─ manifest.json             # PWA manifest
├─ service-worker.js         # Offline caching logic
└─ scripts/
   ├─ app.js                 # Stock in logic
   ├─ stock-out.js           # Stock out logic
   ├─ stock-out-records.js   # Stock out records page
   ├─ menu.js                # Menu helpers
   ├─ login.js               # Login handling
   ├─ admin.js               # Admin dashboard logic
   └─ sw-register.js         # Registers the service worker
```

## Getting Started

1. **Clone or copy** the project files to a folder on your machine.
2. **Serve the files locally** using any static server (recommended) or open the HTML files directly in a compatible browser (Chrome/Edge).
   - Example (Node.js):
     ```bash
     npx http-server . -p 8080
     ```
3. **Open** `http://localhost:8080/login.html` (or the corresponding file path) in the browser.
4. **Sign in** with a configured user account. On first launch, create the initial administrator account or provide `DEFAULT_ADMIN_USERNAME` and `DEFAULT_ADMIN_PASSWORD` in your `.env` file.

## Offline Usage

- The app is installable thanks to `manifest.json` and `service-worker.js`.
- On Chrome/Edge, open the app and choose **Install app** from the URL bar or menu.
- Once installed, the cached pages work without network access; all records remain in the browser’s `localStorage`.

## Browser Requirements

- Works best on Chromium-based browsers (Chrome, Edge) that support the **Web Serial API** for scale integration.
- Ensure the site is served over HTTPS (or `localhost`) to use serial features.

## Data Export

- Stock In, Stock Out, and Admin pages include **Export CSV** buttons.
- CSV exports respect the 60-day retention window and current filters (where applicable).

## Customization Tips

- Tailwind CSS is loaded from a CDN. For offline-only environments, replace CDN usage with a locally hosted stylesheet.
- Update `CACHE_VERSION` in `service-worker.js` when changing cached assets to trigger a refresh.
- Icons for the installable app can be added to `manifest.json` under the `icons` array.

## License

Internal use. Adapt licensing as required for deployment.
