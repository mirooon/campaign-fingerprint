"""Tests of ad_library_search.py on objects shaped like MetaAdsCollector's Ad (no network): python3 -I -m unittest discover -s scripts/py"""
import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(__file__))
import ad_library_search as m  # noqa: E402


def creative(**kw):
    base = dict(body=None, title=None, link_url=None, image_url=None, original_image_url=None, video_hd_url=None, video_sd_url=None, video_url=None)
    base.update(kw)
    return SimpleNamespace(**base)


def ad(start=None, **kw):
    base = dict(
        id="1000000000000501",
        page=SimpleNamespace(id="900000000001", name="Inwestycje Przykladowe", verification="NOT_VERIFIED"),
        page_is_deleted=False,
        delivery_start_time=start,
        delivery_stop_time=None,
        creatives=[creative(body="Zarabiaj z platforma AI", link_url="https://oferta.example/lp", image_url="https://cdn.example/a.jpg")],
        beneficiary_payers=["Testowa Spolka"],
        country_iso_code="PL",
    )
    base.update(kw)
    return SimpleNamespace(**base)


class Record(unittest.TestCase):
    def test_reads_page_payers_creatives_and_dates(self):
        r = m.record(ad(start=datetime(2026, 11, 2, 8, tzinfo=timezone.utc)))
        self.assertEqual((r["id"], r["pageId"], r["pageName"], r["pageVerified"]), ("1000000000000501", "900000000001", "Inwestycje Przykladowe", False))
        self.assertEqual((r["bodies"], r["linkUrls"], r["imageUrls"], r["payers"], r["countries"]), (["Zarabiaj z platforma AI"], ["https://oferta.example/lp"], ["https://cdn.example/a.jpg"], ["Testowa Spolka"], ["PL"]))
        self.assertEqual(r["deliveryStart"], "2026-11-02T08:00:00+00:00")
        self.assertIsNone(r["deliveryStop"])

    def test_a_naive_time_is_taken_as_utc(self):
        self.assertEqual(m.record(ad(start=datetime(2026, 11, 2, 8)))["deliveryStart"], "2026-11-02T08:00:00+00:00")

    def test_a_page_without_a_verification_status_is_unknown_not_unverified(self):
        r = m.record(ad(page=SimpleNamespace(id="9", name="X", verification=None)))
        self.assertIsNone(r["pageVerified"])


class DateRange(unittest.TestCase):
    def test_keeps_ads_that_started_inside_the_range_and_those_with_an_unknown_start(self):
        a = ad(start=datetime(2026, 11, 2, 8, tzinfo=timezone.utc))
        self.assertTrue(m.in_range(a, m.day("2026-11-01"), m.day("2026-11-02")))
        self.assertFalse(m.in_range(a, m.day("2026-11-03"), None))
        self.assertTrue(m.in_range(ad(start=None), m.day("2026-11-03"), None))


if __name__ == "__main__":
    unittest.main()
