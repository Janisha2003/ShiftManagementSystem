"""
models/notification.py
-----------------------
Notification table — stores both in-app alerts and WhatsApp delivery records.
"""

from app.backend.extensions import db
from datetime import datetime


class Notification(db.Model):
    __tablename__ = 'notifications'

    id              = db.Column(db.Integer, primary_key=True)

    # ── Core relationship ──────────────────────────────────────────────────
    user_id         = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    employee_id     = db.Column(db.String(20), db.ForeignKey('employees.id', ondelete='SET NULL'), nullable=True)

    # ── Content ───────────────────────────────────────────────────────────
    title           = db.Column(db.String(255), nullable=False)
    message         = db.Column(db.Text, nullable=False)

    # ── In-app read state ─────────────────────────────────────────────────
    is_read         = db.Column(db.Boolean, default=False)

    # ── WhatsApp shift schedule fields ────────────────────────────────────
    week_start      = db.Column(db.Date,    nullable=True)
    week_end        = db.Column(db.Date,    nullable=True)
    whatsapp_status = db.Column(
        db.Enum('pending', 'sent', 'delivered', 'read', 'failed', name='wa_status'),
        nullable=True,
        default='pending',
    )
    whatsapp_message_id = db.Column(db.String(255), nullable=True)   # Meta message ID
    sent_at         = db.Column(db.DateTime, nullable=True)
    delivered_at    = db.Column(db.DateTime, nullable=True)
    failed_reason   = db.Column(db.Text,    nullable=True)
    retry_count     = db.Column(db.Integer, default=0)

    # ── Timestamps ────────────────────────────────────────────────────────
    created_at      = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at      = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            'id':                   self.id,
            'user_id':              self.user_id,
            'employee_id':          self.employee_id,
            'title':                self.title,
            'message':              self.message,
            'is_read':              self.is_read,
            'week_start':           self.week_start.isoformat()  if self.week_start  else None,
            'week_end':             self.week_end.isoformat()    if self.week_end    else None,
            'whatsapp_status':      self.whatsapp_status,
            'whatsapp_message_id':  self.whatsapp_message_id,
            'sent_at':              self.sent_at.isoformat()     if self.sent_at     else None,
            'delivered_at':         self.delivered_at.isoformat() if self.delivered_at else None,
            'failed_reason':        self.failed_reason,
            'retry_count':          self.retry_count,
            'created_at':           self.created_at.isoformat()  if self.created_at  else None,
        }
