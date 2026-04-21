"""
scheduler.py – Determines which reminders are due to fire.

Uses croniter to parse cron expressions and pytz for timezone handling.
Implements missed-run recovery: if the bot was offline for a window,
any reminders that should have fired in that window are still triggered.
"""

from datetime import datetime, timedelta

import pytz
from croniter import croniter

from utils import load_logs


# How far back (in minutes) to look for missed runs.
# Should be slightly larger than the GitHub Actions cron interval.
LOOKBACK_MINUTES = 20


def get_due_reminders(reminders: list[dict]) -> list[dict]:
    """
    Filter *reminders* to only those that should fire right now
    (or were missed within the lookback window).

    Returns a list of reminder dicts that are due.
    """
    due = []
    now_utc = datetime.now(pytz.utc)

    for reminder in reminders:
        # Skip disabled reminders
        if not reminder.get("enabled", True):
            continue

        tz_name = reminder.get("timezone", "Asia/Kolkata")
        try:
            tz = pytz.timezone(tz_name)
        except pytz.UnknownTimeZoneError:
            print(f"⚠️  Unknown timezone '{tz_name}' for {reminder['id']}, skipping.")
            continue

        now_local = now_utc.astimezone(tz)
        cron_expr = reminder.get("schedule", "")

        if not cron_expr:
            continue

        try:
            if _is_due(cron_expr, now_local, reminder["id"]):
                due.append(reminder)
        except (ValueError, KeyError) as exc:
            print(f"⚠️  Error checking schedule for {reminder.get('id', '?')}: {exc}")

    return due


def _is_due(cron_expr: str, now_local: datetime, reminder_id: str) -> bool:
    """
    Check whether the cron expression has a fire time within the
    lookback window ending at *now_local*.

    This provides missed-run recovery: even if the bot ran a few
    minutes late, it will still catch reminders it missed.
    """
    window_start = now_local - timedelta(minutes=LOOKBACK_MINUTES)

    # croniter iterates *forward* from a base time.
    # We start from window_start and check if any fire time falls
    # between window_start and now_local.
    cron = croniter(cron_expr, window_start)

    # Check up to 5 potential fire times in the window (more than enough).
    for _ in range(5):
        next_fire = cron.get_next(datetime)
        # Make timezone-aware if croniter returns naive datetime
        if next_fire.tzinfo is None:
            next_fire = now_local.tzinfo.localize(next_fire)
        if next_fire > now_local:
            break
        if window_start <= next_fire <= now_local:
            # Check if we already ran this one recently
            if not _already_ran(reminder_id, next_fire):
                return True

    return False


def _already_ran(reminder_id: str, fire_time: datetime) -> bool:
    """
    Check logs.json to see if we already executed this reminder
    within ±2 minutes of the expected fire_time (dedup guard).
    """
    logs = load_logs()
    for entry in reversed(logs.get("runs", [])):
        if entry.get("reminder_id") != reminder_id:
            continue
        try:
            entry_ts = datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00"))
            diff = abs((entry_ts - fire_time.astimezone(pytz.utc)).total_seconds())
            if diff < 300:  # within 2 minutes → already handled
                return True
        except (ValueError, KeyError):
            continue
    return False


def get_next_run(cron_expr: str, timezone: str = "Asia/Kolkata") -> str:
    """Return a human-readable string of the next fire time (for debugging)."""
    tz = pytz.timezone(timezone)
    now = datetime.now(tz)
    cron = croniter(cron_expr, now)
    return cron.get_next(datetime).strftime("%Y-%m-%d %H:%M %Z")
