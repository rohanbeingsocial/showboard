# Showboard in use

[Documentation](README.md) ? [Product overview](../README.md)

[Excel and CSV, no app needed](#excel-and-csv-no-app-needed) ? [In a real app](#in-a-real-app) ? [Inside your own app](#inside-your-own-app)

## Excel and CSV, no app needed

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/images/spreadsheets-dark.gif" />
  <img src="../docs/images/spreadsheets.gif" alt="Claude Code beside Showboard's page over a folder of Excel and CSV files. Asked which regions are behind their 2026 targets, Claude draws a board in rupees: actual against target by region, the gap to target for each region and the cumulative gap by month. Show sources then opens the SQL that joins the workbook's orders with the targets file" width="100%" />
</picture>

A folder of spreadsheets is all it needs. Here Claude Code compares 2026 orders in an Excel workbook with targets in a CSV file, amounts in rupees, and *Show sources* opens the SQL behind a chart.

## In a real app

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/images/meridian-dark.gif" />
  <img src="../docs/images/meridian.gif" alt="Claude Code in an investing app's folder beside Showboard's page. Asked whether silver went up each time the gold/silver ratio crossed above 90 in the past 2 years, Claude reads gold and silver prices from the app's API and draws a board: the ratio crossed above 90 four times, all in February and March 2025; silver was higher 6 months later all 4 times and 1 month later 3 times out of 4; the ratio is 70.7 today. Line charts of the ratio and of silver mark the stretches above 90, bars show silver's moves 1, 3 and 6 months after each cross, and a table lists each stretch" width="100%" />
</picture>

It works on real data too. Meridian, a private investing app, has Showboard inside. Here Claude Code is asked whether silver rose each time the gold/silver ratio crossed above 90. It reads two years of MCX gold and silver prices from the app's own API and draws one board: the ratio and silver side by side, each stretch above 90 marked in orange, and silver's moves 1, 3 and 6 months after each cross.

## Inside your own app

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../docs/images/demo-dark.gif" />
  <img src="../docs/images/demo.gif" alt="Claude Code beside the demo shop's admin app. Asked to open the Aero Standing Desk's orders from October, Claude reads the app's screen with get_screen, then runs the app's filter_orders action, and the app moves from its board page to the Orders page, filtered to October 2026 and the Aero Standing Desk" width="100%" />
</picture>

Mount Showboard in your React app and the agent can also see what is on screen and run the actions you register. Here Claude reads the demo shop's screen with `get_screen`, then runs the shop's own `filter_orders` action, and the app opens its Orders page, filtered.

