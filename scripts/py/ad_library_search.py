"""Search of the Meta Ad Library through MetaAdsCollector (no API key, no login).

Usage: python ad_library_search.py [--query PHRASE] [--advertiser NAME_OR_PAGE_ID] [--country PL]
                                   [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N]
Prints {"ads": [record, ...]} or {"error": "..."} (always exit code 0 for an upstream failure, so the
caller reads the reason). Uses the public web endpoint of the Ad Library (the request the page makes),
so it can break when Meta changes the page. The record keys are read by lib/adlib/meta.ts.
"""
import argparse
import json
import sys
from datetime import datetime, timezone


def iso(dt):
    """ISO string of a datetime (naive values are taken as UTC), or None."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def day(text):
    """UTC start of a YYYY-MM-DD day, or None for an empty value."""
    return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc) if text else None


def record(ad) -> dict:
    """Record of one Ad object of MetaAdsCollector in the shape that lib/adlib/meta.ts reads."""
    page = ad.page
    creatives = ad.creatives or []

    def uniq(values):
        return list(dict.fromkeys(v for v in values if v))

    verification = getattr(page, "verification", None) if page else None
    return {
        "id": ad.id,
        "pageId": page.id if page else None,
        "pageName": page.name if page else None,
        "pageVerified": None if not verification else verification != "NOT_VERIFIED",
        "pageDeleted": ad.page_is_deleted,
        "deliveryStart": iso(ad.delivery_start_time),
        "deliveryStop": iso(ad.delivery_stop_time),
        "bodies": uniq(c.body for c in creatives),
        "titles": uniq(c.title for c in creatives),
        "linkUrls": uniq(c.link_url for c in creatives),
        "imageUrls": uniq(c.image_url or c.original_image_url for c in creatives),
        "videoUrls": uniq(c.video_hd_url or c.video_sd_url or c.video_url for c in creatives),
        "payers": list(ad.beneficiary_payers or []),
        "countries": [ad.country_iso_code] if ad.country_iso_code else [],
    }


def in_range(ad, start, end) -> bool:
    """Whether the delivery start of the ad falls into [start, end] (a missing bound is open; an unknown start passes)."""
    t = ad.delivery_start_time
    if t is None:
        return True
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (start is None or t >= start) and (end is None or t < end.replace(hour=23, minute=59, second=59))


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--query", default="")
    p.add_argument("--advertiser", default="")
    p.add_argument("--country", default="PL")
    p.add_argument("--from", dest="start", default="")
    p.add_argument("--to", dest="end", default="")
    p.add_argument("--limit", type=int, default=25)
    a = p.parse_args()
    start, end = day(a.start), day(a.end)
    try:
        from meta_ads_collector.collector import MetaAdsCollector
        from meta_ads_collector.constants import STATUS_ALL

        collector = MetaAdsCollector()
        page_ids = [a.advertiser] if a.advertiser.isdigit() else None
        # an advertiser name is searched as a phrase and then kept only when the page name contains it
        query = a.query or ("" if page_ids else a.advertiser)
        out = []
        for ad in collector.search(query=query, country=a.country, status=STATUS_ALL, page_ids=page_ids, max_results=a.limit * 4 if (start or end or a.advertiser) else a.limit):
            if a.advertiser and not page_ids and ad.page and a.advertiser.lower() not in (ad.page.name or "").lower():
                continue
            if not in_range(ad, start, end):
                continue
            out.append(record(ad))
            if len(out) >= a.limit:
                break
        json.dump({"ads": out}, sys.stdout, ensure_ascii=False)
    except Exception as e:  # upstream failures are reported to the caller as the reason, not as a crash
        json.dump({"error": f"{type(e).__name__}: {str(e)[:300]}"}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
