"""
services/notification_service.py
----------------------------------
Production-ready WhatsApp Weekly Shift Notification Module.

Workflow (triggered every Sunday 21:00 by APScheduler):
  1. Generate weekly shift allocation  (ShiftScheduler)
  2. For every active employee:
       a. Build personalised shift schedule message
       b. Send via Meta WhatsApp Business Cloud API
       c. Persist result in Notification table
  3. Retry failed sends (up to MAX_RETRIES attempts)
  4. Notify admin of any persistent failures
  5. Write structured execution logs

All data is fetched dynamically from the database.
No phone numbers, employee names, or shift data is hardcoded.
"""

import logging
import time
from datetime import datetime, timedelta, date

from app.backend.extensions import db
from app.backend.models.employee import Employee
from app.backend.models.shift import Shift, ShiftAllocation
from app.backend.models.notification import Notification
from app.backend.models.user import User
from app.backend.utils.whatsapp import send_whatsapp_text, get_message_status
from app.backend.services.shift_scheduler import ShiftScheduler

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────────────────
MAX_RETRIES      = 3
RETRY_DELAY_SEC  = 5          # seconds between retry attempts
DAY_NAMES        = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ─────────────────────────────────────────────────────────────────────────────
# 1. Message builder
# ─────────────────────────────────────────────────────────────────────────────

def generate_weekly_shift_message(employee_id: str, week_start: date) -> str:
    """
    Builds a personalised WhatsApp text message for one employee
    covering the 7-day week that starts on `week_start` (Monday).

    Returns the formatted message string, or raises ValueError if
    the employee is not found.
    """
    week_end   = week_start + timedelta(days=6)
    week_dates = [week_start + timedelta(days=i) for i in range(7)]

    # Fetch employee
    employee = Employee.query.get(employee_id)
    if not employee:
        raise ValueError(f"Employee {employee_id} not found")

    full_name = f"{employee.first_name} {employee.last_name}"

    # Fetch all shift allocations for this employee this week in one query
    allocations = ShiftAllocation.query.filter(
        ShiftAllocation.employee_id == employee_id,
        ShiftAllocation.date >= week_start,
        ShiftAllocation.date <= week_end,
    ).all()

    # Build date → allocation lookup
    alloc_map = {a.date: a for a in allocations}

    # Build day-by-day schedule lines
    schedule_lines = []
    for i, day_date in enumerate(week_dates):
        day_name = DAY_NAMES[i]
        alloc    = alloc_map.get(day_date)

        if alloc and alloc.shift:
            shift      = alloc.shift
            start_str  = shift.start_time.strftime("%I:%M %p") if shift.start_time else "N/A"
            end_str    = shift.end_time.strftime("%I:%M %p")   if shift.end_time   else "N/A"
            schedule_lines.append(
                f"  {day_name}\n"
                f"    Shift : {shift.name}\n"
                f"    Time  : {start_str} - {end_str}"
            )
        else:
            schedule_lines.append(f"  {day_name}\n    Weekly Off")

    schedule_block = "\n\n".join(schedule_lines)

    message = (
        f"Hello {full_name},\n\n"
        f"*Your Weekly Shift Schedule*\n"
        f"Week : {week_start.strftime('%d %b %Y')} to {week_end.strftime('%d %b %Y')}\n\n"
        f"{schedule_block}\n\n"
        f"Please report on time.\n\n"
        f"Thank You\n"
        f"HR Department"
    )
    return message


# ─────────────────────────────────────────────────────────────────────────────
# 2. Single employee notification
# ─────────────────────────────────────────────────────────────────────────────

def send_shift_notification(employee_id: str, week_start: date) -> Notification:
    """
    Generates and sends a WhatsApp shift notification for one employee.

    Retries up to MAX_RETRIES times on failure.
    Persists a Notification record regardless of outcome.

    Returns the saved Notification object.
    """
    employee = Employee.query.get(employee_id)
    if not employee:
        logger.error("send_shift_notification: employee %s not found", employee_id)
        return None

    week_end = week_start + timedelta(days=6)

    # Build message
    try:
        message_text = generate_weekly_shift_message(employee_id, week_start)
    except Exception as exc:
        logger.error("Message generation failed for %s: %s", employee_id, exc)
        message_text = f"Hello {employee.first_name}, your shift schedule is ready. Please check the portal."

    # Prepare notification record
    notif = Notification(
        user_id         = employee.user_id,
        employee_id     = employee_id,
        title           = f"Weekly Shift Schedule — {week_start.strftime('%d %b %Y')}",
        message         = message_text,
        week_start      = week_start,
        week_end        = week_end,
        whatsapp_status = "pending",
        retry_count     = 0,
    )
    db.session.add(notif)
    db.session.flush()   # get notif.id before commit

    # Validate phone number
    phone = (employee.phone or "").strip()
    if not phone:
        notif.whatsapp_status = "failed"
        notif.failed_reason   = "Employee has no phone number on record"
        db.session.commit()
        logger.warning("No phone for employee %s — notification saved as failed", employee_id)
        return notif

    # Attempt send with retry
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        result = send_whatsapp_text(phone, message_text)

        if result["success"]:
            notif.whatsapp_status      = "sent"
            notif.whatsapp_message_id  = result.get("message_id")
            notif.sent_at              = datetime.utcnow()
            notif.failed_reason        = None
            db.session.commit()
            logger.info(
                "WhatsApp sent to %s (%s) — attempt %d/%d",
                employee_id, phone, attempt, MAX_RETRIES,
            )
            return notif

        last_error = result.get("error", "Unknown error")
        notif.retry_count  = attempt
        notif.failed_reason = last_error
        logger.warning(
            "Send attempt %d/%d failed for %s: %s",
            attempt, MAX_RETRIES, employee_id, last_error,
        )

        if attempt < MAX_RETRIES:
            time.sleep(RETRY_DELAY_SEC)

    # All attempts exhausted
    notif.whatsapp_status = "failed"
    notif.failed_reason   = last_error
    db.session.commit()

    logger.error(
        "All %d send attempts failed for employee %s (%s). Reason: %s",
        MAX_RETRIES, employee_id, phone, last_error,
    )
    _notify_admin_of_failure(employee_id, phone, week_start, last_error)
    return notif


# ─────────────────────────────────────────────────────────────────────────────
# 3. Bulk notifications
# ─────────────────────────────────────────────────────────────────────────────

def send_bulk_weekly_notifications(week_start: date) -> dict:
    """
    Sends WhatsApp shift notifications to every active employee for the given week.

    Returns a summary dict:
        total, sent, failed, skipped
    """
    active_employees = Employee.query.filter_by(status="active").all()
    if not active_employees:
        logger.warning("send_bulk_weekly_notifications: no active employees found")
        return {"total": 0, "sent": 0, "failed": 0, "skipped": 0}

    summary = {"total": len(active_employees), "sent": 0, "failed": 0, "skipped": 0}

    logger.info(
        "Starting bulk WhatsApp notifications for week %s — %d employees",
        week_start, len(active_employees),
    )

    for employee in active_employees:
        try:
            notif = send_shift_notification(employee.id, week_start)
            if notif is None:
                summary["skipped"] += 1
            elif notif.whatsapp_status == "sent":
                summary["sent"] += 1
            else:
                summary["failed"] += 1
        except Exception as exc:
            summary["failed"] += 1
            logger.error(
                "Unexpected error sending notification for %s: %s",
                employee.id, exc, exc_info=True,
            )

    logger.info(
        "Bulk notification complete — total=%d sent=%d failed=%d skipped=%d",
        summary["total"], summary["sent"], summary["failed"], summary["skipped"],
    )
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# 4. Retry failed notifications
# ─────────────────────────────────────────────────────────────────────────────

def retry_failed_notifications() -> dict:
    """
    Re-attempts delivery for all Notification records with status='failed'
    and retry_count < MAX_RETRIES.

    Returns a summary dict: retried, recovered, still_failed
    """
    failed_notifs = Notification.query.filter(
        Notification.whatsapp_status == "failed",
        Notification.retry_count < MAX_RETRIES,
        Notification.week_start.isnot(None),
    ).all()

    summary = {"retried": len(failed_notifs), "recovered": 0, "still_failed": 0}

    if not failed_notifs:
        logger.info("retry_failed_notifications: nothing to retry")
        return summary

    logger.info("Retrying %d failed notifications", len(failed_notifs))

    for notif in failed_notifs:
        employee = Employee.query.get(notif.employee_id)
        if not employee:
            notif.failed_reason = "Employee record no longer exists"
            summary["still_failed"] += 1
            continue

        phone = (employee.phone or "").strip()
        if not phone:
            notif.failed_reason = "No phone number on record"
            summary["still_failed"] += 1
            continue

        result = send_whatsapp_text(phone, notif.message)
        notif.retry_count += 1

        if result["success"]:
            notif.whatsapp_status     = "sent"
            notif.whatsapp_message_id = result.get("message_id")
            notif.sent_at             = datetime.utcnow()
            notif.failed_reason       = None
            summary["recovered"] += 1
            logger.info("Retry succeeded for notification id=%d (employee %s)", notif.id, notif.employee_id)
        else:
            notif.failed_reason = result.get("error", "Unknown error")
            summary["still_failed"] += 1
            logger.warning(
                "Retry still failed for notification id=%d: %s",
                notif.id, notif.failed_reason,
            )

    db.session.commit()
    logger.info(
        "Retry complete — retried=%d recovered=%d still_failed=%d",
        summary["retried"], summary["recovered"], summary["still_failed"],
    )
    return summary


# ─────────────────────────────────────────────────────────────────────────────
# 5. Delivery status sync
# ─────────────────────────────────────────────────────────────────────────────

def get_delivery_status(notification_id: int) -> dict:
    """
    Queries the Meta API for the live delivery status of a sent notification
    and updates the Notification record accordingly.

    Returns a dict with keys: success, status, error
    """
    notif = Notification.query.get(notification_id)
    if not notif:
        return {"success": False, "status": None, "error": f"Notification {notification_id} not found"}

    if not notif.whatsapp_message_id:
        return {"success": False, "status": notif.whatsapp_status, "error": "No WhatsApp message_id on record"}

    result = get_message_status(notif.whatsapp_message_id)

    if result["success"]:
        status = result.get("status", "unknown")
        notif.whatsapp_status = status
        if status == "delivered" and not notif.delivered_at:
            notif.delivered_at = datetime.utcnow()
        db.session.commit()
        return {"success": True, "status": status, "error": None}

    return {"success": False, "status": notif.whatsapp_status, "error": result.get("error")}


# ─────────────────────────────────────────────────────────────────────────────
# 6. APScheduler entry-point  (Sunday 21:00)
# ─────────────────────────────────────────────────────────────────────────────

def run_weekly_notification_job():
    """
    Master job executed by APScheduler every Sunday at 21:00.

    Steps:
      1. Determine the upcoming Monday (next week start).
      2. Generate weekly shift allocation via ShiftScheduler.
      3. Send WhatsApp notifications to all active employees.
      4. Retry any immediate failures.
      5. Log execution summary.
    """
    from app.backend.app import create_app         # local import to avoid circular deps

    app = create_app()
    with app.app_context():
        today      = date.today()                  # Sunday
        next_monday = today + timedelta(days=1)    # Monday

        logger.info("=" * 60)
        logger.info("WEEKLY SHIFT NOTIFICATION JOB STARTED")
        logger.info("Triggered : %s (Sunday 21:00)", datetime.utcnow().isoformat())
        logger.info("Week      : %s to %s", next_monday, next_monday + timedelta(days=6))
        logger.info("=" * 60)

        # Step 1 — Allocate shifts
        logger.info("[1/4] Generating weekly shift allocation...")
        sched_result = ShiftScheduler.allocate_weekly_shifts(next_monday.strftime("%Y-%m-%d"))
        logger.info("Scheduler result: %s", sched_result)

        if sched_result.get("status") == "error":
            logger.error("Shift allocation failed — aborting notification job: %s", sched_result["message"])
            return

        # Step 2 — Send notifications
        logger.info("[2/4] Sending WhatsApp notifications...")
        bulk_summary = send_bulk_weekly_notifications(next_monday)
        logger.info("Bulk send summary: %s", bulk_summary)

        # Step 3 — Retry failures
        logger.info("[3/4] Retrying failed notifications...")
        retry_summary = retry_failed_notifications()
        logger.info("Retry summary: %s", retry_summary)

        # Step 4 — Final log
        logger.info("[4/4] Job complete.")
        logger.info(
            "FINAL SUMMARY | Allocated: %s | Sent: %d | Failed: %d | Recovered: %d",
            sched_result.get("message", "N/A"),
            bulk_summary["sent"],
            bulk_summary["failed"],
            retry_summary["recovered"],
        )
        logger.info("=" * 60)


# ─────────────────────────────────────────────────────────────────────────────
# 7. Internal helper — admin alert
# ─────────────────────────────────────────────────────────────────────────────

def _notify_admin_of_failure(employee_id: str, phone: str, week_start: date, reason: str):
    """
    Creates an in-app Notification for every admin user
    when a WhatsApp send has permanently failed.
    """
    try:
        admin_users = User.query.filter_by(role="admin").all()
        for admin in admin_users:
            alert = Notification(
                user_id     = admin.id,
                employee_id = None,
                title       = f"WhatsApp Send Failed — {employee_id}",
                message     = (
                    f"Failed to send weekly shift WhatsApp to employee {employee_id} "
                    f"(phone: {phone}) for week starting {week_start}.\n"
                    f"Reason: {reason}"
                ),
                whatsapp_status = None,
            )
            db.session.add(alert)
        db.session.commit()
        logger.info("Admin failure alert created for employee %s", employee_id)
    except Exception as exc:
        logger.error("Could not create admin alert: %s", exc)
