---
title: Review and publish
---

# Review and publish

An editor submits a page when the draft is ready. An approver checks the preview and approves it, or sends it back. A small team can allow one person to approve their own change. That switch is off unless an admin turns it on.

Approve publishes the page. The builder writes static HTML into a new release and points the live site at that release. The previous release stays, so an admin can roll back.

nginx serves the live release. Cloudflare sits in front and is purged by cache tag when a page is published. There is no second cache between Cloudflare and nginx.

Nothing reaches the public site without that publish step. Agent drafts wait for a person unless a rule on that agent's token says otherwise.

Next: [Hosting and install](/guide/hosting).
