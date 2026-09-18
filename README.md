# Real-Time Facebook Lead Finder

Local pipeline that monitors allowlisted Facebook group tabs and routes either
car-rental leads or targeted technology job openings to separate Telegram
groups. It uses live DOM updates first and a conservative randomized refresh
when Facebook does not update a tab.

## Prerequisites

- macOS, Windows, or Linux machine that can remain powered on and awake
- Node.js 20.6 or newer
- Chrome, Edge, or another Chromium browser
- An authenticated Facebook account with access to the configured groups
- Private credentials for the rental and job notification destinations
- An OpenAI API key when GPT filtering is enabled

Do not automate Facebook login. Use an existing authenticated browser profile.

## Quick start

### 1. Clone and enter the project

```bash
git clone https://github.com/developer-ncdx/car-renter-leads-finder.git
cd car-renter-leads-finder
```

If you already have this folder locally, open a terminal in the project instead.
There are currently no third-party npm packages to install.

### 2. Configure local environment variables

```bash
cp .env.example .env.local
```

Complete the required entries in `.env.local` using `.env.example` as the
template. Keep all real values local and never commit, paste, or screenshot
them. Configure separate rental and job bots with their corresponding group
chat IDs. The bypass option may be used briefly for a notification connection
test, but disable it before normal use so unqualified posts are filtered.

### 3. Start the local notifier

```bash
npm start
```

Keep this terminal running and confirm that the service reports a successful
local startup.

To verify Telegram while the server remains open, use a second terminal:

```bash
npm run test:alert
npm run test:job-alert
```

### 4. Load the unpacked extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository folder containing `manifest.json`.
5. Confirm the extension is enabled.

An **Inactive** service worker is normal. Chromium wakes it whenever the
Facebook content script sends a post.

### 5. Add Facebook groups

1. Click the extension icon in the browser toolbar.
2. Paste a Facebook group URL containing a numeric group ID.
3. Select **Car rental** or **Job posts**.
4. Click **Add**.
5. Repeat for every group that should be monitored.

The popup lists all monitored groups as clickable links with **Remove**
buttons and type badges. Selecting a different type for an existing group
updates its routing. Group settings are saved locally in the browser. Existing
groups are migrated as **Car rental** during the upgrade.

### 6. Open monitored Facebook tabs

1. Open one authenticated tab per configured Facebook group.
2. Leave each group open in its own tab.
3. Add Facebook to the browser's **Never put these sites to sleep** list.
4. Reload each group tab once after installing or updating the extension.

The extension automatically switches monitored group feeds to **New Posts** so
Facebook's selected relevance filter cannot hide chronological arrivals.

Open the tab's DevTools Console and look for:

```text
[Live Car Rental Lead Observer] Ready...
```

The extension automatically clicks Facebook's **New posts** button. If
Facebook provides no live update, each tab uses a staggered fallback refresh
after 60–120 seconds.

### 7. Verify filtering

With filtering enabled, explicit buyer requests for a vehicle are eligible
whether they request self-drive, with-driver service, or do not state a driver
preference. The local rules still reject competitor advertisements, passenger
searches, driver jobs, and posts without buyer intent. GPT performs the final
intent check. Common English, Filipino, and Taglish shorthand is supported,
including `LF`, `L/F`, `LF4`, `LFR`, `ISO`, `HM`, `H/M`, `LP`, `qte`,
`paquote`, `reco`, `avail`, `rnt`, `s/d`, `w/ drv`, and common misspellings.
Vehicle, route, and duration context also lets GPT review unfamiliar wording
instead of rejecting it immediately.

Job groups accept genuine hiring, contract, and freelance posts for AI
engineers, Bubble.io developers, software developers, AI-agent or agentic
developers, AI-assisted developers, AI specialists, and automation engineers
or developers. Job-seeker posts, courses, and service advertisements are
rejected.

Run the regression suite:

```bash
npm test
```

## Runtime architecture

```text
Facebook content script
→ Chrome extension service worker
→ http://127.0.0.1:8787
→ group type routing
  → rental eligibility + GPT → rental Telegram group
  → job eligibility + GPT → jobs Telegram group
```

## Verify it is running

1. Open Chrome DevTools on the Facebook group tab.
2. Select the **Console** panel.
3. Filter for `Live Car Rental Lead Observer`.

At startup, the extension restores post IDs previously acknowledged by the
local service and scans every other post currently loaded in the page. The
console should then show:

```text
[Live Car Rental Lead Observer] Ready. Every unseen post loaded in this monitored tab will be sent for eligibility checking.
```

When Facebook inserts a new post, the console logs a `NEW_POST` payload:

```json
{
  "groupId": "341298636779740",
  "leadType": "rental",
  "postId": "1234567890",
  "authorName": "Displayed name or anonymous alias",
  "postText": "Post text",
  "postUrl": "https://www.facebook.com/groups/341298636779740/posts/1234567890/",
  "isExplicitlyAnonymous": false,
  "detectedAt": "2026-09-16T00:00:00.000Z"
}
```

With bypass testing enabled, every detected new post is sent to Telegram with a
test-mode heading. Use this mode briefly in an active group.

Facebook usually holds new posts behind a **New posts** button rather than
inserting them into the feed. The extension waits a randomized 3 to 12 seconds,
scrolls back to the top, and clicks that button itself.

If Facebook provides neither a DOM update nor a button, the extension performs
a fallback page refresh after a randomized 60 to 120 seconds. Each tab chooses
its own delay, which staggers multiple monitored groups. The refresh is
postponed while a post is being processed, a button click is pending, or the
user is typing on the page. Persistent post history prevents duplicate alerts.

## Detection safeguards

- Uses the post ID as the deduplication key, stored for seven days only after
  the local service acknowledges processing.
- Converts links to a canonical URL without tracking parameters.
- Scans every unseen post loaded in the page, regardless of its position.
- Reconciles the loaded page every five seconds in addition to observing live
  DOM changes.
- Combines Facebook message fragments before classification and accepts strong
  vehicle-rental context when an opening phrase is missing.
- Retries posts when extraction or local-service delivery fails.
- Automatically enforces chronological **New Posts** sorting.
- Never tries to reveal an anonymous poster's real identity.
- Waits a randomized delay before clicking, avoiding a fixed machine cadence.
- Uses the 60-to-120-second refresh only as a fallback when the live feed has
  shown no recent activity.

Facebook can only be scanned for posts it actually loads into the tab. The
chronological sort and fallback refresh maximize coverage, but posts hidden by
Facebook's servers are not present in the DOM and cannot be observed.

## Troubleshooting

- **No startup logs:** Reload the group tab after loading or updating the
  extension and confirm the group appears in the extension popup.
- **Existing posts are processed after changing type:** Rental and job groups
  keep separate acknowledged-post histories.
- **A New posts button appears:** The extension clicks it within 12 seconds. If
  it does not, confirm the console logged `Ready`.
- **Testing with a second device:** Post from the phone while the desktop tab
  already shows `Ready`.
- **Local bridge unavailable:** Start `npm start`, confirm port `8787` is free,
  and then reload the extension and Facebook tab.
- **Job notification delivery fails:** Confirm the second Telegram group chat
  ID and jobs bot token are configured locally, and that bot is a member of
  the jobs group.
- **A new post is skipped:** Facebook may have changed its DOM. Inspect the
  post card for its `/groups/<GROUP_ID>/posts/<POST_ID>/` link and message
  container.

## Enable GPT filtering

After Telegram-only testing succeeds:

1. Add an OpenAI API key to the private local environment file.
2. Select an available low-cost GPT classification model.
3. Disable bypass testing.
4. Restart the local service.

Keep OpenAI and Telegram tokens in the local service environment. Do not
put secrets in this extension because extension source is readable in Chrome.
Rotate any Telegram token that has appeared in a screenshot before using it.

Before calling GPT, a deterministic gate rejects passenger or driver searches,
provider advertisements, and posts without buyer or vehicle-rental context.
Driver preference is optional and self-drive requests are eligible. This
prevents clear false positives and avoids unnecessary API cost. GPT performs
the final intent check only for candidates that pass those rules.

Job groups use a separate deterministic gate and GPT prompt. Only targeted
hiring opportunities proceed; candidates seeking work, training content,
service advertisements, and unrelated roles are dropped.

Run the guardrail regression tests with:

```bash
npm test
```

## Run continuously with PM2

After manual tests pass:

```bash
npm install --global pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Follow the command printed by `pm2 startup` to enable restart after a machine
reboot.

Only monitor groups where this automation and handling of member content are
authorized.
