# 0015: Send mail through Google Workspace and the Gmail API

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

v1 needs outbound email for invites, password resets and approval notices. The earlier draft assumed SMTP settings (host, port, user, password), including Google Workspace as a relay, or a provider such as Postmark. App passwords are a poor fit: Google is retiring them, and they are another secret to store and rotate.

Spencer decided (17 November 2026) that v1 should wire in Google Workspace only, sending through the Gmail API with a Workspace account connected by Google OAuth, set up in the setup wizard or later in Settings (for example `noreply@`). SMTP and Postmark should remain easy to add later.

## Decision

- **v1 transport: Google Workspace**, through the Gmail API. The sending account is connected with Google OAuth (no app passwords, no SMTP).
- **A small `Mailer` transport interface** is the only thing the job handler talks to. An SMTP or Postmark adapter can be added later without changing invites, password reset or the job queue.
- **Connect in the setup wizard or in Settings > Integrations.** The operator pastes a Google OAuth client id and secret (or sets them in the environment), then signs in as the Workspace account. The Gmail scopes are send-only plus reading the account email. A refresh token is required (`access_type=offline`).
- **Tokens are stored encrypted at rest** in the existing secrets table, written only by the OAuth callback, never by `PUT /settings/secrets` and never returned by the API.
- **Emails still go out as `send_email` jobs**, so a slow Gmail call never blocks a request, and failures retry. Settings has a test-send that uses the same transport immediately, so the operator can confirm it works.
- In development and tests, a file outbox remains the default (and always wins when `SITEBUILDER_MAIL_OUTBOX` is set). Production sends only when a Workspace account is connected, or writes to the outbox if that override is set for debugging.

## Consequences

- Organisations need a Google Workspace mailbox and a Google Cloud OAuth client (Gmail API enabled, redirect URI pointed at `/api/v1/settings/mail/google/callback`). That is a small setup step, documented in operations and the wizard.
- The session cookie can stay `SameSite=Strict`. The OAuth callback may arrive without it; the signed, short-lived `state` parameter names the admin who started the connect.
- Adding SMTP or Postmark later is an adapter plus a settings choice, not a rewrite of the job handler.
- The earlier SMTP-password secret is not used in v1.
- The OAuth `state` is signed and includes a one-time nonce stored in the database and deleted on callback, so it cannot be replayed within the 10-minute window.
