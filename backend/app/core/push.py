import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.models import Notification, PushSubscription

logger = logging.getLogger(__name__)


def send_push(db: Session, target_type: str, target_key: str, title: str, body: str, url: str = "/") -> None:
    """Record a notification and, where possible, deliver it as a Web Push message.

    target_type is "session" (guest, keyed by dining session id) or "role" (staff, keyed by
    admin/kitchen/service). A Notification row is always written so the in-app notification
    panel has history even when push isn't configured or the browser hasn't subscribed; the
    actual Web Push send is skipped in that case rather than failing the caller.
    """
    db.add(Notification(target_type=target_type, target_key=str(target_key), title=title, body=body, url=url))
    db.commit()

    settings = get_settings()
    if not settings.vapid_public_key or not settings.vapid_private_key:
        return

    subscriptions = list(
        db.scalars(
            select(PushSubscription).where(
                PushSubscription.target_type == target_type,
                PushSubscription.target_key == str(target_key),
            )
        )
    )
    if not subscriptions:
        return

    payload = json.dumps({"title": title, "body": body, "url": url})
    stale_ids: list[int] = []
    for subscription in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": subscription.endpoint,
                    "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
                },
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
            )
        except WebPushException as exc:
            status_code = getattr(exc.response, "status_code", None)
            if status_code in (404, 410):
                stale_ids.append(subscription.id)
            else:
                logger.warning("Push send failed for subscription %s: %s", subscription.id, exc)

    if stale_ids:
        db.query(PushSubscription).filter(PushSubscription.id.in_(stale_ids)).delete(synchronize_session=False)
        db.commit()
