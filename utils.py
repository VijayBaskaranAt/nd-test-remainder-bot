"""
utils.py – Shared utilities for the reminder bot.

Handles:
  - Loading/saving YAML config
  - Loading/saving JSON logs
  - Template variable rendering
  - Console logging helpers
"""

import json
import os
import re
from datetime import datetime

import pytz
import yaml


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, "reminders.yaml")
LOGS_PATH = os.path.join(BASE_DIR, "logs.json")


# ---------------------------------------------------------------------------
# YAML helpers
# ---------------------------------------------------------------------------

def load_reminders(path: str = CONFIG_PATH) -> list[dict]:
    """Load reminders list from the YAML config file."""
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data.get("reminders", [])


def save_reminders(reminders: list[dict], path: str = CONFIG_PATH) -> None:
    """Persist reminders list back to the YAML config file."""
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump({"reminders": reminders}, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


# ---------------------------------------------------------------------------
# Log helpers
# ---------------------------------------------------------------------------

def load_logs(path: str = LOGS_PATH) -> dict:
    """Load the JSON log file. Returns a dict with a 'runs' list."""
    if not os.path.exists(path):
        return {"runs": []}
    with open(path, "r") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return {"runs": []}


def save_logs(logs: dict, path: str = LOGS_PATH) -> None:
    """Save the JSON log file, keeping the last 500 entries."""
    logs["runs"] = logs["runs"][-500:]  # cap history
    with open(path, "w") as f:
        json.dump(logs, f, indent=2)


def append_log(reminder_id: str, status: str, message: str = "", path: str = LOGS_PATH) -> None:
    """Add a run entry to logs.json and print to console."""
    logs = load_logs(path)
    entry = {
        "reminder_id": reminder_id,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "status": status,
        "message": message,
    }
    logs["runs"].append(entry)
    save_logs(logs, path)

    # Console output (visible in GitHub Actions logs)
    icon = "✅" if status == "success" else "❌"
    print(f"{icon} [{entry['timestamp']}] {reminder_id} → {status}: {message}")


# ---------------------------------------------------------------------------
# Template rendering
# ---------------------------------------------------------------------------

# Supported variables → callables returning replacement strings
TEMPLATE_VARS = {
    "month": lambda now: now.strftime("%B"),       # e.g. "April"
    "date": lambda now: now.strftime("%Y-%m-%d"),  # e.g. "2026-04-21"
    "year": lambda now: str(now.year),              # e.g. "2026"
    "day": lambda now: now.strftime("%A"),          # e.g. "Monday"
    "time": lambda now: now.strftime("%H:%M"),      # e.g. "09:00"
}


def render_template(template: str, timezone: str = "Asia/Kolkata") -> str:
    """Replace {{var}} placeholders with actual values in the given timezone."""
    tz = pytz.timezone(timezone)
    now = datetime.now(tz)

    def _replace(match: re.Match) -> str:
        key = match.group(1).strip()
        fn = TEMPLATE_VARS.get(key)
        return fn(now) if fn else match.group(0)  # leave unknown vars as-is

    return re.sub(r"\{\{(\s*\w+\s*)\}\}", _replace, template)


# ---------------------------------------------------------------------------
# Console banner
# ---------------------------------------------------------------------------

def print_banner() -> None:
    """Print a startup banner for better log readability."""
    print("=" * 60)
    print("  🔔  Reminder Bot – running scheduled check")
    print(f"  🕒  UTC now: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
