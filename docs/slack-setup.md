# Slack Integration Setup Guide

This guide walks you through connecting Open Brain to a Slack workspace so that messages in a designated channel are automatically captured as thoughts.

---

## 1. Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App** > **From scratch**.
3. Name: `Open Brain` (or any name you prefer).
4. Select your workspace.
5. Click **Create App**.

---

## 2. Configure OAuth & Permissions

1. In the left sidebar, navigate to **OAuth & Permissions**.
2. Under **Bot Token Scopes**, add the following scopes:
   - `chat:write` — post confirmation messages
   - `channels:history` — read messages in public channels
3. Click **Install to Workspace** and authorize.
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`) — you will need this as `SLACK_BOT_TOKEN`.

---

## 3. Configure Event Subscriptions

1. In the left sidebar, navigate to **Event Subscriptions**.
2. Toggle **Enable Events** to On.
3. Set the **Request URL** to:
   ```
   https://<your-project-ref>.supabase.co/functions/v1/slack-webhook
   ```
   Slack will send a verification challenge — the edge function must be deployed first (see step 5).
4. Under **Subscribe to bot events**, add:
   - `message.channels` — messages in public channels
5. Click **Save Changes**.

---

## 4. Set Supabase Secrets

Find your **Signing Secret** under the app’s **Basic Information** > **App Credentials**.

Set both secrets in your Supabase project:

```bash
supabase secrets set SLACK_SIGNING_SECRET=your-signing-secret
supabase secrets set SLACK_BOT_TOKEN=xoxb-your-token
```

---

## 5. Deploy the Edge Function

```bash
supabase functions deploy slack-webhook
```

After deploying, go back to Event Subscriptions and re-enter the Request URL if the challenge verification has not yet passed.

---

## 6. Invite the Bot to a Channel

1. In Slack, open the channel you want to capture thoughts from.
2. Type `/invite @Open Brain` (or whatever you named the app).
3. Send a test message — the bot should reply in a thread with a confirmation.

---

## 7. Troubleshooting

| Problem | Cause / Fix |
|---|---|
| "Challenge failed" when setting Request URL | Ensure the function is deployed and the URL is correct. |
| 401 Unauthorized in function logs | Verify `SLACK_SIGNING_SECRET` matches the value in App Credentials. |
| Bot does not reply | Check `SLACK_BOT_TOKEN` is set and the bot is invited to the channel. |
| Messages not appearing in DB | Check Supabase function logs in the dashboard for errors. |
| Duplicate messages | The idempotency key (`channel:ts`) prevents duplicates automatically. |
