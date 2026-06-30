# CCRN Apps — Cloud Sync Migration Card

Your study data (progress, favorites, scores, missed-question bank) lives in **jsonbin.io**, not on the web host. Moving from Netlify to GitHub Pages does **not** touch it. You only need to re-enter your sync details once on the new site, because the browser stores them per-domain.

**One Master Key for all four apps. Each app has its own separate Bin ID.**

---

## STEP A — Before you take Netlify down, copy your details

While your Netlify site still works, open each app and grab its Bin ID:

1. Open the app on your Netlify URL.
2. Tap **☁ Cloud sync**.
3. The panel shows your **Master Key** and that app's **Bin ID** — copy them into the table below.

(Backup option: log in at **jsonbin.io → My Bins**. Your four bins are named exactly as listed in the "Bin name" column below, each with its ID.)

---

## Your details (fill in the blanks)

**Master Key (same for every app):**

```
________________________________________________
```

| App file | jsonbin "Bin name" | Bin ID (paste yours) |
|---|---|---|
| `ccrn-recall.html` | `ccrn-progress` | __________________________ |
| `ccrn-practice-exam.html` | `ccrn-exam-history` | __________________________ |
| `ccrn-drills.html` | `ccrn-drills` | __________________________ |
| `ccrn-mock.html` | `ccrn-mock` | __________________________ |

---

## STEP B — Reconnect on GitHub Pages (one time, per device)

After your site is live at `https://YOURUSERNAME.github.io/ccrn/`:

1. Open **ccrn-recall.html**.
2. Tap **☁ Cloud sync**.
3. Paste the **Master Key** and the **recall Bin ID** (`ccrn-progress`).
4. Tap **Connect**, then **Sync now**. Your data reappears.
5. Repeat for the other three apps, each with the **same Master Key** but **its own Bin ID** from the table.

That's it — all progress, favorites, scores, and your missed-question/mastery bank pull back down from the cloud.

---

## Notes

- **Same Master Key everywhere.** Only the Bin ID changes per app.
- If you use a phone *and* a computer, do Step B once on each device (the key/Bin IDs are stored per browser).
- Your Master Key is never written into the app files — it only lives in your browser, so the public GitHub repo stays safe.
- If an app says "bin not found," double-check you pasted that app's own Bin ID (not another app's).
- Future updates: edit the file on GitHub → **Commit** → it redeploys automatically. No credits, ever.
