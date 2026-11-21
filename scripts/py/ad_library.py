"""Meta Ad Library details for ad-library IDs, through MetaAdsCollector (no API key).

Usage: python ad_library.py <ad_library_id> [...]
Prints {"ads": {id: record | {"error": str}}}. A record holds the DSA transparency data shown
under "See ad details": payer/beneficiary, takedown flag, violated policies, EU reach and audience,
plus the advertiser page when Meta still shows it. Uses the public web endpoint of the Ad Library
(the same request the page makes), so it can break when Meta changes the page.
"""
import json
import sys
import time

from meta_ads_collector.client import MetaAdsClient


def pick(d, *path):
    for k in path:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def record(det: dict) -> dict:
    aaa = det.get("aaa_info") or {}
    eu = pick(det, "transparency_by_location", "eu_transparency") or {}
    page = pick(det, "advertiser", "ad_library_page_info", "page_info") or {}
    pairs = aaa.get("payer_beneficiary_data") or []
    age = eu.get("age_audience") or {}
    return {
        "payers": sorted({p.get("payer") for p in pairs if p.get("payer")}),
        "beneficiaries": sorted({p.get("beneficiary") for p in pairs if p.get("beneficiary")}),
        "takenDown": aaa.get("is_ad_taken_down"),
        "violations": [v.get("name") for v in det.get("violation_types") or [] if v.get("name")],
        "euReach": eu.get("eu_total_reach"),
        "ageMin": age.get("min"),
        "ageMax": age.get("max"),
        "gender": eu.get("gender_audience"),
        "locations": [l.get("name") for l in eu.get("location_audience") or [] if l.get("name") and not l.get("excluded")],
        "pageId": page.get("page_id") or pick(det, "advertiser", "page", "id"),
        "pageName": page.get("page_name"),
        "pageDeleted": page.get("page_is_deleted"),
        "pageVerification": page.get("page_verification"),
    }


def main() -> int:
    ids = [a for a in sys.argv[1:] if a.isdigit()]
    out: dict[str, dict] = {}
    client = MetaAdsClient()
    try:
        client.initialize()
    except Exception as e:
        json.dump({"ads": {i: {"error": f"init: {e}"} for i in ids}}, sys.stdout)
        return 0
    for n, ad_id in enumerate(ids):
        if n:
            time.sleep(1.0)  # be gentle with the public endpoint
        try:
            # page_id is required by the query but any value works for an archive ID
            out[ad_id] = record(client.get_ad_insights(ad_id, "0", country="ALL"))
        except Exception as e:
            out[ad_id] = {"error": str(e)[:300]}
    json.dump({"ads": out}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
