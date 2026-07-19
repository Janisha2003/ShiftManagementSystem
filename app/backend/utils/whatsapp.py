"""
utils/whatsapp.py
-----------------
Reusable Meta WhatsApp Business Cloud API client.
All credentials are loaded exclusively from environment variables (.env).
"""

import os
import logging
import requests
from datetime import datetime

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration — loaded from .env via python-dotenv (loaded in config.py)
# ---------------------------------------------------------------------------

def _get_config():
    """Returns WhatsApp API config dict from environment variables."""
    return {
        "access_token":     os.environ.get("WHATSAPP_ACCESS_TOKEN", ""),
        "phone_number_id":  os.environ.get("WHATSAPP_PHONE_NUMBER_ID", ""),
        "verify_token":     os.environ.get("WHATSAPP_VERIFY_TOKEN", ""),
        "api_version":      os.environ.get("WHATSAPP_API_VERSION", "v19.0"),
        "template_name":    os.environ.get("WHATSAPP_TEMPLATE_NAME", "shift_schedule"),
    }


def _build_url():
    cfg = _get_config()
    return (
        f"https://graph.facebook.com/{cfg['api_version']}"
        f"/{cfg['phone_number_id']}/messages"
    )


# ---------------------------------------------------------------------------
# Core send function
# ---------------------------------------------------------------------------

def send_whatsapp_text(phone_number: str, message_text: str) -> dict:
    """
    Sends a free-form text message via WhatsApp Business Cloud API.

    Args:
        phone_number: Recipient phone in E.164 format (e.g. +15550100001).
        message_text: Plain-text message body.

    Returns:
        dict with keys:
            success  (bool)
            message_id (str | None)
            error    (str | None)
            raw      (dict)  – full API response
    """
    cfg = _get_config()

    if not cfg["access_token"] or not cfg["phone_number_id"]:
        return {
            "success": False,
            "message_id": None,
            "error": "WhatsApp API credentials not configured in .env",
            "raw": {},
        }

    # Normalise phone — strip spaces, ensure no duplicate '+'
    phone_number = phone_number.strip().replace(" ", "")
    if not phone_number.startswith("+"):
        phone_number = "+" + phone_number

    headers = {
        "Authorization": f"Bearer {cfg['access_token']}",
        "Content-Type": "application/json",
    }

    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": phone_number,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": message_text,
        },
    }

    try:
        response = requests.post(
            _build_url(),
            headers=headers,
            json=payload,
            timeout=15,
        )
        data = response.json()

        if response.status_code == 200 and "messages" in data:
            msg_id = data["messages"][0].get("id")
            logger.info("WhatsApp sent to %s — message_id=%s", phone_number, msg_id)
            return {"success": True, "message_id": msg_id, "error": None, "raw": data}

        # API returned an error body
        error_detail = data.get("error", {}).get("message", str(data))
        logger.warning("WhatsApp API error for %s: %s", phone_number, error_detail)
        return {"success": False, "message_id": None, "error": error_detail, "raw": data}

    except requests.exceptions.Timeout:
        msg = "WhatsApp API request timed out"
        logger.error("%s for %s", msg, phone_number)
        return {"success": False, "message_id": None, "error": msg, "raw": {}}

    except requests.exceptions.RequestException as exc:
        msg = f"Network error: {str(exc)}"
        logger.error("WhatsApp send failed for %s: %s", phone_number, msg)
        return {"success": False, "message_id": None, "error": msg, "raw": {}}


# ---------------------------------------------------------------------------
# Delivery status check
# ---------------------------------------------------------------------------

def get_message_status(message_id: str) -> dict:
    """
    Queries the delivery status of a sent WhatsApp message.

    Args:
        message_id: The message ID returned by send_whatsapp_text().

    Returns:
        dict with keys: success, status, error, raw
    """
    cfg = _get_config()

    if not cfg["access_token"]:
        return {"success": False, "status": None, "error": "Credentials not configured", "raw": {}}

    url = (
        f"https://graph.facebook.com/{cfg['api_version']}"
        f"/{message_id}"
    )
    headers = {"Authorization": f"Bearer {cfg['access_token']}"}

    try:
        response = requests.get(url, headers=headers, timeout=10)
        data = response.json()

        if response.status_code == 200:
            status = data.get("status", "unknown")
            return {"success": True, "status": status, "error": None, "raw": data}

        error_detail = data.get("error", {}).get("message", str(data))
        return {"success": False, "status": None, "error": error_detail, "raw": data}

    except requests.exceptions.RequestException as exc:
        return {"success": False, "status": None, "error": str(exc), "raw": {}}
