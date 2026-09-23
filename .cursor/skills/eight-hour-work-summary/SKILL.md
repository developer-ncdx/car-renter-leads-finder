---
name: eight-hour-work-summary
description: Summarizes verified work completed during the preceding eight hours into exactly three concise bullets. Use when the user requests a daily report, an eight-hour progress update, or three bullets describing recent work.
---

# Eight-Hour Work Summary

## Instructions

1. Determine the requested time window, defaulting to the eight hours before
   the user's current timestamp.
2. Review available conversation history, completed tool actions, git history,
   changed files, tests, and deployment results from that window.
3. Include only completed, verified work. Do not present plans, failed
   attempts, or unverified claims as accomplishments.
4. Prioritize user-facing outcomes and combine related technical fixes into
   one clear update.
5. Exclude routine restarts, screenshots, investigation steps, and repeated
   troubleshooting unless they produced a material result.

## Output format

- Return exactly three Markdown bullet points.
- Use one short sentence per bullet.
- Do not add a heading, introduction, conclusion, or implementation details.
- Use plain language suitable for a daily status report.

## Example

- Improved notification scanning and reliable post extraction.
- Expanded job-role matching for web-development positions.
- Strengthened advertisement filtering and duplicate prevention.
