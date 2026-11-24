# Vision

> **Want a super fast, easy to update site? This is for you.**

## The problem

Most organisations, charities especially, run their website on a traditional CMS such as WordPress. Over time the site ends up depending on one agency or one person who knows how it works. New pages cost developer hours, the site gets slower and more fragile, and a proper redesign is a large one-off project that keeps getting put off.

Hosted builders (Wix, Framer, Webflow) are easier, but you rent the site rather than own it, and you are limited by the platform.

## The idea

A site builder where the main way to make changes is a conversation.

A member of staff says "I need a donation page for the winter appeal". The agent asks five or six questions (headline, story, hero image, which donation form, call to action, publish date), builds a draft from the site's approved blocks, and shows a preview. They go back and forth until it looks right. Someone with approval rights checks it and clicks Approve. The page is live a few seconds later, fast and on-brand.

Underneath, it is an ordinary, very fast static website that the organisation owns outright and can host on one small server.

## What it is

- A brand-first setup wizard that locks in colours, fonts, logo, menus and the allowed page templates.
- A library of well-built, fast blocks (hero, story, stats, gallery, donation embed and so on).
- A visual editor and a chat agent that both work on the same strict JSON page model.
- An approval flow with preview, versions and one-click rollback.
- A publisher that outputs static HTML and purges the Cloudflare cache.
- A speed advisor that flags anything slowing the site down.

## Focus: one thing, done well

WordPress does far too much. It is a blog engine, a shop, a forum, a membership system and a plugin marketplace all at once, and most sites pay for that in speed, security updates and complexity while using a fraction of it.

Skewstone does one thing: lets people build and update fast, beautiful websites easily. Every feature request is judged against that. If something is better done by a dedicated tool, we embed that tool rather than rebuild it.

## Non-goals

These are deliberate. They keep the project small, fast and secure.

- **No open plugin marketplace.** Plugins come from a small curated catalogue, each one signed by the Skewstone maintainers. Nothing third-party, and nothing is installed unless an admin chooses it. A plugin is declarative (a checked manifest, templates and CSS, no server code and no visitor JavaScript). New code blocks still go through review. Agents do not put HTML or JavaScript on a page.
- **No payments.** Donations and payments come from embedded forms (for example Virtuous).
- **No ecommerce.** No shop, cart, stock or checkout. Embed a dedicated shop if needed.
- **No visitor accounts or memberships.** No logins, paywalls or member areas on the public site.
- **No comments, forums or community features.**
- **No built-in CRM or email marketing.** Use dedicated tools and embed their forms.
- **No free-form code from the AI.** The AI assembles approved blocks, nothing more.
- **No server-side rendering per request.** Published sites are static.
- **Not a hosted service you rent.** It is software you run (or pay someone to run for you).

## Who it is for

First, a real pilot organisation with real staff and real content. Then other charities and small organisations with the same "only one person knows the website" problem, once it is open source.

## What success looks like

- A non-technical member of staff can publish a good-looking new page in under 15 minutes, with no training beyond a short walkthrough.
- Published pages score 95 or more on Lighthouse performance on mobile.
- The site costs little more than a small server plus Cloudflare to run.
