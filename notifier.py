"""
notifier.py – Sends notifications through configured channels.

Supported channels:
  - google_chat  (Google Chat webhook)
  - email        (SMTP – placeholder implementation)
  - webhook      (generic HTTP POST)

Includes retry with exponential backoff (3 attempts).
"""

import json
import os
import smtplib
import time
from email.mime.text import MIMEText

import requests


# ---------------------------------------------------------------------------
# Retry configuration
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
BACKOFF_SECONDS = [10, 30, 120]  # exponential-ish backoff


def _retry(fn, *args, **kwargs) -> bool:
    """
    Execute *fn* with retries and exponential backoff.
    Returns True on success, False if all retries exhausted.
    """
    for attempt in range(MAX_RETRIES):
        try:
            fn(*args, **kwargs)
            return True
        except Exception as exc:
            wait = BACKOFF_SECONDS[attempt] if attempt < len(BACKOFF_SECONDS) else BACKOFF_SECONDS[-1]
            print(f"   ⚠️  Attempt {attempt + 1}/{MAX_RETRIES} failed: {exc}")
            if attempt < MAX_RETRIES - 1:
                print(f"   ⏳ Retrying in {wait}s …")
                time.sleep(wait)
    return False


# ---------------------------------------------------------------------------
# Channel: Google Chat Webhook
# ---------------------------------------------------------------------------

def _send_google_chat(message: str) -> None:
    """Send a message via Google Chat incoming webhook."""
    webhook_url = os.environ.get("GOOGLE_CHAT_WEBHOOK")
    if not webhook_url:
        raise EnvironmentError("GOOGLE_CHAT_WEBHOOK environment variable not set")

    # Google Chat webhook expects a JSON payload with a "text" field
    payload = {"text": message}
    resp = requests.post(
        webhook_url,
        json=payload,
        headers={"Content-Type": "application/json; charset=UTF-8"},
        timeout=15,
    )
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Channel: Email (SMTP)
# ---------------------------------------------------------------------------

def _send_email(message: str) -> None:
    """Send a notification email via SMTP."""
    host = os.environ.get("EMAIL_HOST", "smtp.gmail.com")
    port = int(os.environ.get("EMAIL_PORT", "587"))
    user = os.environ.get("EMAIL_USER")
    password = os.environ.get("EMAIL_PASS")
    to_addr = os.environ.get("EMAIL_TO", user)  # default: send to self

    if not user or not password:
        raise EnvironmentError("EMAIL_USER / EMAIL_PASS not set – skipping email.")

    msg = MIMEText(message)
    msg["Subject"] = "🔔 Reminder Bot Notification"
    msg["From"] = user
    msg["To"] = to_addr

    with smtplib.SMTP(host, port, timeout=15) as server:
        server.starttls()
        server.login(user, password)
        server.send_message(msg)


# ---------------------------------------------------------------------------
# Channel: Generic Webhook (HTTP POST)
# ---------------------------------------------------------------------------

def _send_webhook(message: str) -> None:
    """POST a JSON payload to a generic webhook URL."""
    webhook_url = os.environ.get("WEBHOOK_URL")
    if not webhook_url:
        raise EnvironmentError("WEBHOOK_URL environment variable not set")

    payload = {"text": message, "source": "reminder-bot"}
    resp = requests.post(webhook_url, json=payload, timeout=15)
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

CHANNEL_MAP = {
    "google_chat": _send_google_chat,
    "email": _send_email,
    "webhook": _send_webhook,
}


def send_notification(message: str, channels: list[str]) -> dict[str, bool]:
    """
    Dispatch *message* to each channel in *channels*.

    Returns a dict of {channel: success_bool}.
    """
    results: dict[str, bool] = {}

    for channel in channels:
        fn = CHANNEL_MAP.get(channel)
        if fn is None:
            print(f"   ⚠️  Unknown channel '{channel}' – skipping.")
            results[channel] = False
            continue

        print(f"   📤 Sending via {channel} …")
        ok = _retry(fn, message)
        results[channel] = ok

    return results
