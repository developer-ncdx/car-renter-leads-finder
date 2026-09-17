# Real-Time Car Rental Lead Finder

Local pipeline that monitors allowlisted Facebook group tabs, filters for
people actively looking to rent a vehicle with a driver, and sends qualified
leads to Telegram. It uses live DOM updates first and a conservative randomized
refresh when Facebook does not update a tab.

## Prerequisites

- macOS, Windows, or Linux machine that can remain powered on and awake
- Node.js 20.6 or newer
- Chrome, Edge, or another Chromium browser
- An authenticated Facebook account with access to the configured groups
- Private credentials for the notification destination
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
them. The bypass option may be used briefly for a notification connection
test, but disable it before normal use so unqualified posts are filtered.

### 3. Configure Facebook groups

Open `manifest.json` and add one URL pattern for each group:

```json
"matches": [
  "https://www.facebook.com/groups/GROUP_ID*",
  "https://www.facebook.com/groups/ANOTHER_GROUP_ID*"
]
```

Use only the numeric group ID. Keep the final `*` so base, sorting, and post
URLs match.

### 4. Start the local notifier

```bash
npm start
```

Keep this terminal running and confirm that the service reports a successful
local startup.

To verify Telegram while the server remains open, use a second terminal:

```bash
npm run test:alert
```

### 5. Load the unpacked extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository folder containing `manifest.json`.
5. Confirm the extension is enabled.

An **Inactive** service worker is normal. Chromium wakes it whenever the
Facebook content script sends a post.

### 6. Open monitored Facebook tabs

1. Open one authenticated tab per configured Facebook group.
2. Sort every group by **New Posts**.
3. Leave each tab near the top of its feed.
4. Add Facebook to the browser's **Never put these sites to sleep** list.
5. Reload each group tab once after installing or updating the extension.

Open the tab's DevTools Console and look for:

```text
[Live Car Rental Lead Observer] Ready...
```

The extension automatically clicks Facebook's **New posts** button. If
Facebook provides no live update, each tab uses a staggered fallback refresh
after 60–120 seconds.

### 7. Verify filtering

With filtering enabled, only explicit buyer requests for a vehicle with a
driver are eligible. The local rules reject self-drive requests, competitor
advertisements, passenger searches, driver jobs, and posts that do not
explicitly request a driver. GPT performs the final intent check.

Run the regression suite:

```bash
npm test
```

## Runtime architecture

```text
Facebook content script
→ Chrome extension service worker
→ http://127.0.0.1:8787
→ deterministic eligibility rules
→ GPT intent classifier
→ Telegram
```

## Verify it is running

1. Open Chrome DevTools on the Facebook group tab.
2. Select the **Console** panel.
3. Filter for `Live Car Rental Lead Observer`.

On the first run for a group, the extension runs a five-second baseline. Posts
already on screen are recorded as seen and are not emitted. That history is
saved to `chrome.storage.local` for seven days, so later reloads skip the
baseline and report how many posts were restored. The console should then show:

```text
[Live Car Rental Lead Observer] Ready. Keep this group tab sorted by New Posts and near the top of the feed.
```

When Facebook inserts a new post, the console logs a `NEW_POST` payload:

```json
{
  "groupId": "341298636779740",
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

- Uses the post ID as the deduplication key, stored for seven days.
- Converts links to a canonical URL without tracking parameters.
- Treats posts loaded farther down while scrolling as old content.
- Never tries to reveal an anonymous poster's real identity.
- Does not emit posts already visible during the first run for a group.
- Sends at most five posts in the first fifteen seconds after a page load, so a
  long absence cannot flood Telegram.
- Waits a randomized delay before clicking, avoiding a fixed machine cadence.
- Uses the 60-to-120-second refresh only as a fallback when the live feed has
  shown no recent activity.

Keep the tab near the top of the feed. Facebook virtualizes feed content, so
scrolling far down is intentionally excluded from new-post detection.

## Troubleshooting

- **No startup logs:** Reload the group tab after loading or updating the
  extension and confirm the URL contains the configured group ID.
- **No output for existing posts:** This is expected; on the first run for a
  group the initial posts form the baseline.
- **A New posts button appears:** The extension clicks it within 12 seconds. If
  it does not, confirm the console logged `Ready` first, since the click is
  suppressed during the baseline.
- **Testing with a second device:** Post from the phone while the desktop tab
  already shows `Ready`, and do not refresh the desktop tab.
- **Local bridge unavailable:** Start `npm start`, confirm port `8787` is free,
  and then reload the extension and Facebook tab.
- **Notification delivery fails:** Confirm the private notification credentials
  and destination settings are current.
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

Before calling GPT, a deterministic gate rejects explicit self-drive requests,
posts without a driver requirement, passenger or driver searches, provider
advertisements, and posts without explicit buyer intent. This prevents clear
false positives and avoids unnecessary API cost. GPT performs the final intent
check only for candidates that pass those rules.

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
