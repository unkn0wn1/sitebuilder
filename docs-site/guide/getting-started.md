---
title: Get started
---

# Get started

Skewstone builds and updates a fast static website. A member of staff describes the page they want. The assistant asks a few questions and drafts the page from the site's approved blocks and brand. A person approves it, and the site publishes as static HTML.

You need Node 22 or newer.

```bash
npm install
npm run seed
npm run dev
```

`npm run dev` serves the builder at `http://localhost:3000`. `npm run seed` creates a local database and prints a one-off admin password unless you set `SEED_ADMIN_PASSWORD`.

The public demo, when it is running, is a separate copy of the builder at `https://demo-admin.skewstone.com`. The sign-in on that host is published on the marketing page. It is not the password for your own install.

Next: [Editing overview](/guide/editing).
