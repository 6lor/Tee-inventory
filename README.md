# Tee Inventory

A phone-first stock and sales tracker for T-shirts (S, M, L, XL, 2XL, 3XL) and one-size tote bags.
It is a small offline web app (PWA). You add it to your iPhone home screen and it runs full-screen like a normal app. All data stays on the phone.

## Features

- **Sell (sales mode).** Pick a design by its photo, then tap a size once for each item sold. Items collect in a "current sale" so one customer can buy several things. After **Complete sale** you get a few seconds to **Undo**.
- **Stock (inventory mode).** Pick a design by its photo, then choose one of two options:
  - **Count totals.** Enter the real count for *every* size. Save stays disabled until every size has a number. Differences are saved as a *count fix*, which can go up or down and **never counts as a sale**.
  - **Add received.** Enter how many new items arrived per size.
- **Designs.** Create T-shirt or tote designs by hand, with a photo (camera or library), an optional price and starting stock.
- **Stats.** Items sold, number of sales and revenue for today, 7 days, 30 days or all time. Shows best sellers with a per-size breakdown, which T-shirt sizes sell most, and a full activity log. Any entry in the log can be undone, and its stock is restored.
- **Backup.** Export or import a JSON backup, and export the full history as a CSV (opens in Excel, Numbers or Google Sheets).

## Running it on your iPhone

The app has to be served over HTTPS for iPhone offline support. The easiest free option is GitHub Pages, which is already set up in this repo:

1. Merge this branch into `main`.
2. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
   (Pages on a private repository needs a paid GitHub plan. If you don't have one, make the repo public; your inventory data is never uploaded.)
3. The **Deploy app to GitHub Pages** workflow publishes the `app/` folder to `https://<your-user>.github.io/Tee-inventory/`.
4. On the iPhone, open that URL in **Safari**, tap **Share → Add to Home Screen**.
5. Launch it from the home screen icon. After the first launch it works without internet.

Updates: when you push changes to `main`, the app picks them up the next time it opens with a connection.

### Important about data

- Data lives in the browser storage of the home-screen app on that one phone. It is **not** shared with Safari tabs or other devices.
- Deleting the home-screen app deletes its data. Use **Designs → Export backup** now and then and save the file to Files or iCloud Drive.

## Running on a computer for development

```sh
cd app
python3 -m http.server 8000
# open http://localhost:8000
```

No build step or dependencies are needed. Everything is plain HTML, CSS and JavaScript modules.

## Project layout

```
app/
  index.html            app shell
  css/app.css           styles (mobile first, light/dark)
  js/app.js             UI and logic
  js/db.js              IndexedDB storage
  sw.js                 offline cache
  manifest.webmanifest  home-screen app metadata
  icons/                app icons
.github/workflows/pages.yml   deploys app/ to GitHub Pages
```

## Data model (for the later Google sync)

- **products**: `{ id, name, kind: 'tee' | 'tote', price, image, stock: { S, M, L, XL, 2XL, 3XL } | { OS }, lastCountAt }`
- **events** (history, append-only): `{ id, ts, type: 'sale' | 'count' | 'restock', productId, productName, kind, size, delta, price?, saleId? }`

Stock always equals the sum of its events. This makes it easy to sync the history to a Google Sheet or Doc later: push new events, and rebuild stock from them.
