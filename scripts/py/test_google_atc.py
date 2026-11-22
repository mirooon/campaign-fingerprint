"""Tests of google_atc.py on recorded responses (no network, no credentials): python3 -I -m unittest discover -s scripts/py"""
import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(__file__))
import google_atc as g  # noqa: E402

GIB = 1024 ** 3
# a row of the BigQuery client for creative_stats (synthetic values), as the client returns it
ROW = {
    "advertiser_id": "AR0000000000000000001",
    "creative_id": "CR0000000000000000001",
    "ad_format_type": "VIDEO",
    "advertiser_location": "PL",
    "ad_funded_by": "Fundator Testowy",
    "advertiser_disclosed_name": "Nazwa Wyswietlana",
    "advertiser_legal_name": "Fikcyjna Firma Sp. z o.o.",
    "advertiser_verification_status": "VERIFIED",
    "regions": ["PL", "DE"],
    "first_shown": "2026-10-01",
    "last_shown": "2026-11-01",
}


def args(**over):
    base = dict(advertiser="", creative="", keyword="", location="", country="", start="", end="", limit=100, max_bytes=10 * GIB, regions="", project="p", backend="auto")
    base.update(over)
    return SimpleNamespace(**base)


class FakeResultRow:
    def __init__(self, data):
        self.data = data

    def items(self):
        return self.data.items()


class FakeBigQuery:
    """Stands for the google.cloud.bigquery module: records the job configs."""

    class ScalarQueryParameter:
        def __init__(self, name, type_, value):
            self.name, self.type_, self.value = name, type_, value

    class QueryJobConfig:
        def __init__(self, **kw):
            self.kw = kw


class FakeClient:
    """A client with recorded answers: a dry run reports `bytes_by_columns`, a real run returns the rows."""

    def __init__(self, rows, bytes_by_level):
        self.rows, self.bytes_by_level, self.queries = rows, bytes_by_level, []

    def query(self, sql, job_config):
        dry = job_config.kw.get("dry_run", False)
        self.queries.append((sql, dry, job_config.kw.get("maximum_bytes_billed")))
        if dry:
            level = "dates" if "first_shown" in sql else "regions" if "region_code" in sql.split("FROM")[0] else "identity" if "advertiser_legal_name" in sql.split("FROM")[0] else "lean"
            return SimpleNamespace(total_bytes_processed=self.bytes_by_level[level])
        return SimpleNamespace(result=lambda: [FakeResultRow(r) for r in self.rows])


def maker(client):
    return lambda project: (client, FakeBigQuery)


class BuildQuery(unittest.TestCase):
    def test_advertiser_id_is_a_parameter_and_regions_are_written_into_the_sql(self):
        sql, params = g.build_query(args(advertiser="AR0000000000000000001", regions="PL,DE"), g.LEAN)
        self.assertIn("advertiser_id = @advertiser_id", sql)
        self.assertIn("r.region_code IN ('PL', 'DE')", sql)
        self.assertIn(("advertiser_id", "STRING", "AR0000000000000000001"), params)
        self.assertNotIn("AR0000000000000000001", sql)

    def test_name_matches_disclosed_or_legal_name_ignoring_case(self):
        sql, params = g.build_query(args(advertiser="Fikcyjna"), g.IDENTITY)
        self.assertIn("LOWER(advertiser_disclosed_name) LIKE @advertiser_name OR LOWER(advertiser_legal_name) LIKE @advertiser_name", sql)
        self.assertIn(("advertiser_name", "STRING", "%fikcyjna%"), params)

    def test_country_dates_and_location_filter_the_display_regions_and_the_advertiser(self):
        sql, params = g.build_query(args(country="pl", start="2026-01-01", end="2026-11-01", location="pl"), g.REGIONS)
        self.assertIn("advertiser_location = @location", sql)
        self.assertIn("r.region_code = @country", sql)
        self.assertIn("SAFE_CAST(r.last_shown AS DATE) >= @from_date", sql)
        self.assertIn("SAFE_CAST(r.first_shown AS DATE) <= @to_date", sql)
        self.assertEqual({p[0]: p[2] for p in params}, {"location": "PL", "country": "PL", "from_date": "2026-01-01", "to_date": "2026-11-01", "row_limit": "100"})

    def test_creative_id_is_a_parameter(self):
        sql, params = g.build_query(args(creative="CR0000000000000000001"), g.LEAN)
        self.assertIn("creative_id = @creative_id", sql)
        self.assertIn(("creative_id", "STRING", "CR0000000000000000001"), params)

    def test_rejects_a_region_code_that_is_not_two_letters(self):
        with self.assertRaises(ValueError):
            g.build_query(args(regions="PL,'; DROP"), g.LEAN)


class Search(unittest.TestCase):
    def test_takes_the_richest_level_that_fits_and_returns_rows_with_the_creative_address(self):
        client = FakeClient([ROW], {"dates": 34 * GIB, "regions": 21 * GIB, "identity": 19 * GIB, "lean": 9 * GIB})
        out = g.search(args(max_bytes=20 * GIB, advertiser="AR0000000000000000001"), client_maker=maker(client))
        self.assertEqual((out["backend"], out["detail"], out["bytesEstimated"]), ("client", "identity", 19 * GIB))
        self.assertEqual(out["rows"][0]["creative_page_url"], "https://adstransparency.google.com/advertiser/AR0000000000000000001/creative/CR0000000000000000001")
        # the real run is billed at most the limit
        self.assertEqual(client.queries[-1][2], 20 * GIB)

    def test_degrades_to_the_lean_level_under_the_default_limit(self):
        client = FakeClient([ROW], {"dates": 34 * GIB, "regions": 21 * GIB, "identity": 19 * GIB, "lean": 9 * GIB})
        out = g.search(args(advertiser="AR0000000000000000001"), client_maker=maker(client))
        self.assertEqual(out["detail"], "lean")

    def test_refuses_a_query_over_the_limit_with_a_readable_message_and_runs_nothing(self):
        client = FakeClient([ROW], {"dates": 50 * GIB, "regions": 40 * GIB, "identity": 31 * GIB, "lean": 25 * GIB})
        out = g.search(args(), client_maker=maker(client))
        self.assertEqual(out["kind"], "over_limit")
        self.assertIn("25.0 GB", out["error"])
        self.assertIn("ADLIB_BQ_MAX_BYTES", out["error"])
        self.assertTrue(all(q[1] for q in client.queries), "only dry runs")

    def test_reports_missing_access_with_the_way_to_get_it(self):
        out = g.search(args(backend="client"), client_maker=lambda project: None)
        self.assertEqual(out["kind"], "no_access")
        self.assertIn("gcloud auth application-default login", out["howToGetAccess"])


class BqCli(unittest.TestCase):
    def test_estimates_with_a_dry_run_and_runs_with_the_byte_limit(self):
        calls = []

        def runner(cmd, **kw):
            calls.append(cmd)
            if "--dry_run" in cmd:
                return SimpleNamespace(returncode=0, stdout="Query successfully validated. Assuming the tables are not modified, running this query will process 9000000000 bytes of data.", stderr="")
            return SimpleNamespace(returncode=0, stdout=json.dumps([{"advertiser_id": "AR1", "creative_id": "CR1", "regions": None}]), stderr="")

        backend = g.BqCliBackend("proj", runner)
        sql, params = g.build_query(args(advertiser="AR1"), g.LEAN)
        self.assertEqual(backend.estimate(sql, params), 9000000000)
        rows = backend.run(sql, params, 10 * GIB)
        self.assertEqual(rows[0]["creative_page_url"], "https://adstransparency.google.com/advertiser/AR1/creative/CR1")
        self.assertEqual(rows[0]["regions"], [])
        self.assertIn(f"--maximum_bytes_billed={10 * GIB}", calls[-1])
        self.assertIn("--parameter=advertiser_id:STRING:AR1", calls[-1])

    def test_a_failed_bq_call_gives_the_last_line_of_its_error(self):
        runner = lambda cmd, **kw: SimpleNamespace(returncode=1, stdout="", stderr="Traceback\nBigQuery error: Access Denied")  # noqa: E731
        with self.assertRaisesRegex(RuntimeError, "Access Denied"):
            g.BqCliBackend("proj", runner).estimate("SELECT 1", [])


class Check(unittest.TestCase):
    def test_client_with_credentials_is_preferred(self):
        self.assertEqual(g.check("p", client_maker=lambda p: object(), which=lambda x: "/bin/bq")["backend"], "client")

    def test_bq_cli_with_a_project_is_the_fallback(self):
        self.assertEqual(g.check("p", client_maker=lambda p: None, which=lambda x: "/bin/bq")["backend"], "bq")

    def test_nothing_available_gives_the_reason(self):
        out = g.check(None, client_maker=lambda p: None, which=lambda x: None)
        self.assertFalse(out["ok"])
        self.assertIn("ADC", out["reason"])


if __name__ == "__main__":
    unittest.main()
