# Real-Time Facebook Lead Finder

Local pipeline that monitors allowlisted Facebook group tabs and routes either
car-rental leads or targeted technology job openings to separate Telegram
groups. It watches Facebook's in-page notification list for links or
notification IDs that resolve to new group posts and also observes live DOM
updates in any open group tabs.
It does not automatically refresh Facebook pages.

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
2. Paste a Facebook group URL containing either a numeric ID or a custom
   group name, such as `/groups/ITJobsPilipinas/`.
3. Select **Car rental** or **Job posts**.
4. Click **Add**.
5. Repeat for every group that should be monitored.

The popup lists all monitored groups as clickable links with **Remove**
buttons and type badges. Selecting a different type for an existing group
updates its routing. Group settings are saved locally in the browser. Existing
groups are migrated as **Car rental** during the upgrade.

### 6. Enable notification-driven monitoring

1. In each configured Facebook group, open **Manage notifications** and select
   **All posts**.
2. Open `https://www.facebook.com/notifications/` in one authenticated tab.
3. Add Facebook to the browser's **Always keep these sites active** or
   **Never put these sites to sleep** list.
4. Reload the Notifications tab once after installing or updating the
   extension.
5. Keep that Notifications tab open. Existing notifications become the
   baseline; only links that appear afterward are handled.

Open the Notifications tab's DevTools Console and look for:

```text
[Lead Notifications] Ready with 3 monitored groups. Existing notifications were used as the baseline.
```

When Facebook inserts an explicit new-post notification containing either a
direct post link or a group notification ID for a monitored group, the
extension opens that target in an inactive temporary tab. Comment, reaction,
and other group notifications are ignored.
The existing post extractor verifies freshness, sends the post through the
configured rental or job pipeline, and closes the temporary tab. At most two
temporary extraction tabs are allowed at once, and abandoned tabs close after
three minutes. The Notifications console then reports whether each post was
sent to Telegram, rejected, stale, already processed, failed, or timed out.

Opening each monitored group in its own tab remains optional. Those tabs still
provide live DOM detection, automatically switch the feed to **New Posts**, and
click Facebook's **New posts** button when it appears. They are never refreshed
on a timer.

### 7. Verify filtering

With filtering enabled, explicit buyer requests for a vehicle are eligible
whether they request self-drive, with-driver service, or do not state a driver
preference. The local rules still reject competitor advertisements, passenger
searches, driver jobs, and posts without buyer intent. Rate lists, booking
instructions, everyday availability, owner-driver ads, and renter-requirement
lists are treated as provider advertisements. Past-client testimonials,
delivered-unit updates, discount offers, and recurring rental packages are
also rejected. Promotional copy such as **available now**, **book early**,
**secure your date**, and **serving you** contributes to provider detection.
Seller profiles are also recognized from combinations of vehicle lists,
business phone numbers, promotional hashtags, professional-driver offers, and
free delivery. Door-to-door service menus, booking policies, capacity menus,
route advertisements, and declarative **available self-drive** offers are
rejected as well. Promo-rate listings that direct readers to a Facebook page,
advertise rental dates, or use dense rental hashtags are also rejected.
Monthly-rental promotions with customer menus, delivery offers, flexible
periods, or rhetorical renter questions are treated as provider ads.
Explicit buyer requests require stronger seller evidence before being
rejected. GPT performs the final intent check. Common English,
Filipino, and Taglish shorthand is supported,
including `LF`, `L/F`, `LF4`, `LFR`, `ISO`, `HM`, `H/M`, `LP`, `qte`,
`paquote`, `reco`, `avail`, `rnt`, `s/d`, `w/ drv`, and common misspellings.
Decorative Unicode lettering is normalized before filtering. Vehicle, route,
and duration context also lets GPT review unfamiliar wording instead of
rejecting it immediately.

Job groups accept genuine hiring, contract, and freelance posts for AI
engineers, Bubble.io developers, software, web, frontend, backend, and
full-stack developers, AI-agent or agentic developers, AI-assisted developers,
AI specialists, and automation engineers or developers. Job-seeker posts,
courses, and service advertisements are rejected. Short explicit captions
such as `Looking for software engineer`, `Need AI engineer`, and
`Hiring Bubble developer` are accepted directly after the job-seeker and
service-ad guardrails pass.

Run the regression suite:

```bash
npm test
```

## Runtime architecture

```text
Facebook Notifications content script
→ inactive Facebook post tab
→ Facebook post content script
→ Chrome extension service worker
→ http://127.0.0.1:8787
→ group type routing
  → rental eligibility + GPT → rental Telegram group
  → job eligibility + GPT → jobs Telegram group
```

## Verify it is running

1. Open Chrome DevTools on the Facebook Notifications tab.
2. Select the **Console** panel.
3. Filter for `Lead Notifications`.

After reloading that tab, the console should show:

```text
[Lead Notifications] Ready with 3 monitored groups. Existing notifications were used as the baseline.
```

Have another account publish a fresh post in a monitored group. If Facebook
adds a direct post link to the in-page notification list, the console reports
that it opened the post for extraction. Existing notifications present before
the `Ready` message are intentionally ignored.

For optional live-feed detection, open DevTools on a monitored group tab and
filter for `Live Facebook Lead Observer`.

At startup, the extension restores handled post IDs and inspects other posts
currently loaded in the page. Only posts with a verified Facebook timestamp
younger than 50 minutes proceed to eligibility checking. The console should
then show:

```text
[Live Facebook Lead Observer] Ready. Every unseen post loaded in this monitored tab will be checked for its configured lead type.
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
  "publishedAt": "2026-09-16T00:00:00.000Z",
  "isExplicitlyAnonymous": false,
  "detectedAt": "2026-09-16T00:00:00.000Z"
}
```

With bypass testing enabled, every detected new post is sent to Telegram with a
test-mode heading. Use this mode briefly in an active group.

Facebook usually holds new feed posts behind a **New posts** button rather than
inserting them directly. In an optional group tab, the extension waits a
randomized 3 to 12 seconds, scrolls to the top, and clicks that button.
Notification-driven extraction does not depend on that feed button, but it
does depend on Facebook delivering an in-page group notification that Facebook
can resolve to the post.

## Detection safeguards

- Uses the post ID as the deduplication key, stored for seven days after the
  post is handled or skipped by the freshness rule.
- Suppresses identical author-and-post content for six hours even when
  Facebook exposes it under different post IDs.
- Converts links to a canonical URL without tracking parameters.
- Inspects every unseen post loaded in the page, regardless of its position,
  but only classifies posts verified to be less than 50 minutes old.
- Reads timestamp evidence from permalink metadata and anonymous-post headers.
- Uses the arrival time of an explicit **new post** notification when the
  temporary Facebook post page omits its timestamp.
- Extracts a notification-linked post without its own permalink only when the
  content is inside the verified direct-post dialog; unrelated page content is
  never assigned to the requested post ID.
- Retries unverified timestamps every 30 seconds for up to 50 minutes instead
  of permanently skipping them on the first extraction failure.
- Reconciles the loaded page every five seconds in addition to observing live
  DOM changes.
- Combines Facebook message fragments before classification and accepts strong
  vehicle-rental context when an opening phrase is missing.
- Retries posts when extraction or local-service delivery fails.
- Automatically enforces chronological **New Posts** sorting.
- Never tries to reveal an anonymous poster's real identity.
- Waits a randomized delay before clicking, avoiding a fixed machine cadence.
- Never automatically refreshes Facebook pages.
- Processes at most two notification-linked post tabs concurrently and closes
  each temporary tab after processing or a three-minute timeout.

Facebook can only be scanned for posts it actually loads into the tab. The
notification path is best-effort: Facebook may delay, combine, or omit
notifications, and an operating-system banner alone cannot be read by the
extension. Posts that Facebook exposes through neither the notification DOM
nor an open group tab cannot be observed.

## Troubleshooting

- **No startup logs:** Reload the group tab after loading or updating the
  extension and confirm the group appears in the extension popup.
- **No notification observer log:** Keep
  `https://www.facebook.com/notifications/` open, reload it after updating the
  extension, and filter its Console for `Lead Notifications`.
- **A group notification is missing:** Confirm **All posts** is enabled for
  that specific group. Facebook does not guarantee delivery of every
  notification.
- **Only a macOS or Windows banner appears:** Browser extensions cannot read
  another application's operating-system notifications; the notification
  must also appear in Facebook's in-page notification list with a post link.
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
