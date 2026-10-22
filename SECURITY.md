# Security policy

## Reporting a problem

Please report security problems privately, not in a public issue: open this repository's **Security** tab and choose **Report a vulnerability**. Only the maintainer can read the report. Say what you ran, what happened, and what someone could do with it.

Once a fix is released, the report can be published, with credit to you if you want it.

## Versions

Fixes go into the latest release on [npm](https://www.npmjs.com/package/showboard). Showboard is young (0.x), so please check that the problem still happens on the latest version.

## What Showboard promises

Your agent can read your data, but not change it: queries are read-only, the HTTP handler answers only `localhost`, and in your app the agent can run only the actions you register. The details are in the README's [Safety](README.md#safety) section. A way around any of these is a security problem worth reporting.
