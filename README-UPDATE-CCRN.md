# Update your existing CCRN repo in place (don't delete anything)

You'll add the hub + CSC/CMC to the CCRN repo you already have. Nothing gets deleted,
and because the URL stays the same, your CCRN cloud progress is untouched — no
reconnecting, no re-entering the Master Key.

## The 7 files to upload
Drag ALL of these into the root of your existing CCRN repo, in one upload:

- `index.html`  ← NEW hub. **Overwrites** your old CCRN launcher (that's intended).
- `ccrn.html`   ← your CCRN launcher, now living under this name. NEW file.
- `csccmc.html` ← the CSC/CMC app. NEW file.
- `ccrn-recall.html`
- `ccrn-practice-exam.html`  ← these 4 **overwrite** the ones already in the repo.
- `ccrn-drills.html`            The only change is one link ("← All apps" now points
- `ccrn-mock.html`             to `ccrn.html` instead of `index.html`).

You do NOT need to rename anything by hand — uploading `index.html` (the hub) replaces
the old launcher, and `ccrn.html` becomes the CCRN menu.

## Steps
1. Open your CCRN repo on GitHub → **Add file → Upload files**.
2. Drag in all 7 `.html` files at once.
3. When it warns that `index.html` and the four `ccrn-*.html` files already exist, let
   them **overwrite**. Commit.
4. Done. Your site is unchanged in address; the landing page is now the hub.
   - Hub:       `https://dangeios.github.io/<ccrn-repo>/`
   - CCRN:      `.../ccrn.html`  (and its four apps)
   - CSC/CMC:   `.../csccmc.html`

## About your progress
- **CCRN:** same repo = same URL = same origin. Your key and cloud bins are tied to that
  URL, so CCRN keeps working with zero setup. (Still worth confirming the ☁ badge says
  "synced" first, and copying your Master Key somewhere safe as general insurance.)
- **CSC/CMC:** it now lives at `.../csccmc.html`. If you ever saved CSC/CMC progress from
  the *old* `CSCCMCStudy` address, that's a different origin — open the CSC/CMC app at the
  new URL and paste the **same Master Key** once to pull it in. If you hadn't really used
  the CSC/CMC app yet, there's nothing to move and you can ignore this.

## The old CSCCMCStudy repo
You can leave it or delete it later — your call. Once the merged setup works, deleting it
changes nothing (its data, if any, is in the cloud under that old origin; pulling it into
the new app just needs the Master Key as noted above).
