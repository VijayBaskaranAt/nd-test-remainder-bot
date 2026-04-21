# 🔔 Reminder Bot

A lightweight, config-driven reminder automation system that runs on **GitHub Actions** and sends scheduled notifications via **Google Chat**, **Email**, or **Webhook**.

Includes a fully working **web dashboard** (GitHub Pages) for managing reminders through your browser — no backend required.

---

## ✨ Features

- **Config-driven** — reminders defined in `reminders.yaml`
- **Cron scheduling** — standard 5-field cron expressions
- **Timezone support** — per-reminder timezone (default: `Asia/Kolkata`)
- **Multiple channels** — Google Chat webhook, Email (SMTP), generic Webhook
- **Template variables** — `{{month}}`, `{{date}}`, `{{year}}`, `{{day}}`, `{{time}}`
- **Retry with backoff** — 3 retries at 10s / 30s / 120s intervals
- **Missed-run recovery** — catches jobs skipped by GitHub Actions delays
- **Enable/Disable** — toggle reminders without deleting them
- **Web dashboard** — full CRUD via GitHub API, deployable on GitHub Pages
- **Zero infrastructure** — runs entirely on GitHub Actions (free tier)

---

## 📁 Project Structure

```
reminder-bot/
├── main.py                        # Entry point
├── scheduler.py                   # Cron parsing + due check
├── notifier.py                    # Channel dispatchers + retry
├── utils.py                       # Config I/O, templates, logging
├── reminders.yaml                 # Reminder definitions
├── logs.json                      # Run history
├── requirements.txt               # Python deps
├── .github/workflows/
│   └── reminder.yml               # GitHub Actions workflow
└── dashboard/
    ├── index.html                 # Dashboard UI
    ├── style.css                  # Styles
    └── app.js                     # Frontend logic + GitHub API
```

---

## 🚀 Quick Start

### 1. Clone & Configure

```bash
git clone https://github.com/<your-org>/reminder-bot.git
cd reminder-bot
```

### 2. Set GitHub Secrets

Go to **Settings → Secrets → Actions** and add:

| Secret | Description |
|--------|-------------|
| `GOOGLE_CHAT_WEBHOOK` | Google Chat space webhook URL |
| `EMAIL_HOST` | SMTP host (optional) |
| `EMAIL_USER` | SMTP username (optional) |
| `EMAIL_PASS` | SMTP password (optional) |
| `EMAIL_TO` | Recipient email (optional) |
| `WEBHOOK_URL` | Generic webhook URL (optional) |

### 3. Edit Reminders

Edit `reminders.yaml` directly, or use the dashboard.

### 4. Enable GitHub Actions

The workflow runs every 5 minutes automatically. You can also trigger it manually from the **Actions** tab.

---

## 🌐 Dashboard

The dashboard is a static site that connects to your GitHub repo via the GitHub REST API.

### Deploy on GitHub Pages

1. Go to **Settings → Pages**
2. Set source to **Deploy from a branch**
3. Select `main` branch and `/dashboard` folder
4. Save — your dashboard will be live at `https://<user>.github.io/<repo>/`

### First-time Setup

1. Open the dashboard
2. Click the ⚙️ settings icon
3. Enter your repo owner, name, and a **Personal Access Token** (PAT with `repo` scope)
4. Click **Save & Connect**

Your token is stored **locally in your browser** — it is never sent anywhere except the GitHub API.

---

## ⚙️ Reminder Config

```yaml
reminders:
  - id: invoice_reminder
    message: "💰 Send invoice for {{month}} {{year}}"
    schedule: "0 9 2 * *"
    timezone: "Asia/Kolkata"
    enabled: true
    channels:
      - google_chat
    metadata:
      team: "finance"
      tags:
        - billing
        - monthly
```

### Template Variables

| Variable | Example Output |
|----------|---------------|
| `{{month}}` | April |
| `{{date}}` | 2026-04-21 |
| `{{year}}` | 2026 |
| `{{day}}` | Monday |
| `{{time}}` | 09:00 |

---

## 🧪 Run Locally

```bash
pip install -r requirements.txt
export GOOGLE_CHAT_WEBHOOK="https://chat.googleapis.com/v1/spaces/..."
python main.py
```

---

## 📄 License

MIT