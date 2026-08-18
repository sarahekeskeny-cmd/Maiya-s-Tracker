# Maiya's Dashboard

A production tracker with the same look and feel as Radina's dashboard: growing
goal circles, editable activity, and pipeline tables — built fresh with Maiya's
own metrics. Plain HTML/CSS/JS, no build step, so it deploys to Render as a
static site exactly like the current one.

## What's inside
- **Goal circles** — Lives (75), New Clients (48), Premium ($150,000), Points (250,000). Edit the current value or the goal itself right under each ring.
- **Case Open** — client name, Lives, New Clients, Premium, AUM, notes.
- **Applications Submitted** — same columns as Case Open.
- **Conversion & Projected Close** — two stages, for Lives, New Clients, and Premium:
  - **Case Open → Submitted**, auto-calculated, with an override rate.
  - **Submitted → Placed Business**, auto-calculated from clients marked **In Force** in the Current Clients table below, with its own override rate. "Projected placed" chains both stages to estimate how much of today's open pipeline should ultimately go In Force.
- **Current Clients** — the full pipeline: Client Name, Source (color-coded, editable list — add your own like a specific event name), Lives, New Clients, Premium, AUM, Status (color-coded: Fact Finder Complete → Said "Yes" → Submitted an App → Waiting for Medical → In Underwriting → In Force), Date Added, and Notes.
- **Hot List** — Date Opened, Client Name, FF Income, Action Date, Lives, New Clients, Premium, AUM, notes.

**How it connects:** moving a client's Status to **In Force** automatically
recalculates the Lives, New Clients, and Premium goal circles, and the
"Placed Business" numbers in the conversion panel — both pull live from
whichever clients are currently marked In Force. You can still type directly
into any goal circle's number by hand; it'll simply get recalculated the next
time a client's status or numbers change.

Every field saves automatically to Supabase as you type (look for "Synced" in
the top right). Add or delete rows with the buttons on each table.

## Getting this online (no terminal needed)

**Step 1 — Set up the database.**
Go to supabase.com and start a new project (keep it separate from Radina's, so their data never mixes). Once it opens, look for "SQL Editor" in the left sidebar, click it, then click "New query." Open the `supabase_schema.sql` file from this folder, copy everything in it, paste it into that box, and click Run. That builds all the tables the dashboard needs.

**Step 2 — Get your two connection codes.**
Still in Supabase, click "Settings" in the left sidebar, then "API." You'll see a "Project URL" and an "anon public" key — copy both somewhere handy, you'll need them next.

**Step 3 — Tell the dashboard about your database.**
Open the `config.js` file from this folder in any text editor. Replace the two placeholder lines with the URL and key you just copied, then save.

**Step 4 — Put the files on GitHub.**
Go to github.com and create a new, empty repository. On the page that appears right after, look for a link that says "uploading an existing file" — click that, then drag all six files from this folder (index.html, styles.css, app.js, config.js, supabase_schema.sql, README.md) into the browser window and click "Commit changes." No commands needed.

**Step 5 — Deploy on Render.**
Go to your Render dashboard, click New → Static Site, and connect the GitHub repository you just created. Leave the "Build command" box empty, and set "Publish directory" to a single period: `.` Click Create — Render will give you a live web address a minute or two later.

That's it — once it's live, any edits Maiya makes on the dashboard save straight to Supabase automatically.

If any one of these steps trips you up, tell me which number and I'll walk through just that part with you.

## Adjusting goals later
The four goal targets (75 / 48 / $150,000 / 250,000) are just starting values —
edit the right-hand number under any ring at any time and it saves immediately.

## Notes
- All tables sync in near-real time to Supabase, so the dashboard works from
  any device once it's deployed.
- If you ever want Maiya to log in with her own password instead of an open
  link, that's a small follow-up (swap the RLS policies for auth-based ones)
  — just flag it and it's a quick change.
