"""Google Ads Transparency Center through the public BigQuery dataset (no scraping).

Dataset: bigquery-public-data.google_ads_transparency_center.creative_stats (EEA + Turkey). It has the
advertiser ID (AR...), the creative ID, the address of the creative's page in the Transparency Center,
the format, the disclosed and legal name of the advertiser, its country, verification status, the
regions and dates of display and the funder (`ad_funded_by`). It has NO landing domain.

Usage: python google_atc.py [--advertiser AR...|NAME] [--creative CR...] [--keyword TEXT] [--location PL] [--country PL]
                            [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N] [--max-bytes N]
                            [--regions PL,DE,...] [--project ID] [--backend auto|client|bq] [--check]
Prints one JSON object:
  {"rows": [...], "backend": "client"|"bq", "bytesEstimated": N}              on success
  {"error": "...", "kind": "no_access"|"over_limit"|"failed", ...}             on failure (exit code 0)
  {"ok": bool, "backend": ..., "reason": ...}                                  with --check

Every query is estimated first (dry run, free) and refused when it would bill more than --max-bytes,
and it also runs with `maximum_bytes_billed` set to the same limit. The `google-cloud-bigquery` client
needs Application Default Credentials; without them the `bq` CLI of the Google Cloud SDK is used.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

TABLE = "`bigquery-public-data.google_ads_transparency_center.creative_stats`"
ADVERTISER_ID_RE = re.compile(r"^AR[0-9]+$")
REGION_RE = re.compile(r"^[A-Z]{2}$")
ACCESS_HINT = "gcloud auth application-default login oraz gcloud config set project <projekt z sandboxem BigQuery> (albo samo gcloud auth login dla CLI bq)"


class OverLimit(Exception):
    """The estimated bytes of a query exceed the configured limit."""

    def __init__(self, estimated: int, limit: int):
        super().__init__(f"zapytanie przetworzyłoby {estimated / 1024 ** 3:.1f} GB, limit to {limit / 1024 ** 3:.1f} GB")
        self.estimated = estimated
        self.limit = limit


class NoAccess(Exception):
    """No BigQuery credentials or project."""


# Columns by level of detail. BigQuery bills whole columns, not rows, and the sizes (dry run, 22.11) differ
# a lot: advertiser_id and creative_id 3.9 GB each, the names 3.8 GB each, creative_page_url 16.8 GB, the
# dates 6.3 GB each. The search takes the richest level that fits into --max-bytes. The address of the
# creative's page is built from the two IDs instead of reading creative_page_url (16.8 GB).
LEAN = ["advertiser_id", "creative_id", "ad_format_type", "advertiser_location", "ad_funded_by"]
IDENTITY = LEAN + ["advertiser_disclosed_name", "advertiser_legal_name", "advertiser_verification_status"]
REGIONS = IDENTITY + ["(SELECT ARRAY_AGG(DISTINCT r.region_code) FROM UNNEST(region_stats) r) AS regions"]
DATES = REGIONS + [
    "(SELECT MIN(r.first_shown) FROM UNNEST(region_stats) r) AS first_shown",
    "(SELECT MAX(r.last_shown) FROM UNNEST(region_stats) r) AS last_shown",
]
TIERS = [("dates", DATES), ("regions", REGIONS), ("identity", IDENTITY), ("lean", LEAN)]
LIBRARY_URL = "https://adstransparency.google.com/advertiser/{advertiser_id}/creative/{creative_id}"


def build_query(a, columns: list[str]) -> tuple[str, list[tuple[str, str, str]]]:
    """SQL and parameters (name, BigQuery type, value) for the arguments of a search and the chosen columns.

    All user text goes through query parameters; the region codes (from the configuration) are validated
    and written into the SQL, because the `bq` CLI cannot pass an array parameter reliably.
    """
    where, params = [], []
    name_cond = "(LOWER(advertiser_disclosed_name) LIKE @{n} OR LOWER(advertiser_legal_name) LIKE @{n})"
    if a.advertiser:
        if ADVERTISER_ID_RE.match(a.advertiser):
            where.append("advertiser_id = @advertiser_id")
            params.append(("advertiser_id", "STRING", a.advertiser))
        else:
            where.append(name_cond.format(n="advertiser_name"))
            params.append(("advertiser_name", "STRING", f"%{a.advertiser.lower()}%"))
    if a.keyword:
        # the dataset has no ad text: a keyword can only match the advertiser's name
        where.append(name_cond.format(n="keyword"))
        params.append(("keyword", "STRING", f"%{a.keyword.lower()}%"))
    if a.creative:
        where.append("creative_id = @creative_id")
        params.append(("creative_id", "STRING", a.creative))
    if a.location:
        where.append("advertiser_location = @location")
        params.append(("location", "STRING", a.location.upper()))
    region_conds = []
    if a.country:
        region_conds.append("r.region_code = @country")
        params.append(("country", "STRING", a.country.upper()))
    elif a.regions:
        codes = [c for c in a.regions.split(",") if c]
        if not all(REGION_RE.match(c) for c in codes):
            raise ValueError("nieprawidłowy kod regionu w --regions")
        region_conds.append("r.region_code IN (" + ", ".join(f"'{c}'" for c in codes) + ")")
    if a.start:
        region_conds.append("SAFE_CAST(r.last_shown AS DATE) >= @from_date")
        params.append(("from_date", "DATE", a.start))
    if a.end:
        region_conds.append("SAFE_CAST(r.first_shown AS DATE) <= @to_date")
        params.append(("to_date", "DATE", a.end))
    if region_conds:
        where.append("EXISTS (SELECT 1 FROM UNNEST(region_stats) r WHERE " + " AND ".join(region_conds) + ")")
    sql = "SELECT " + ", ".join(columns) + f" FROM {TABLE}" + (" WHERE " + " AND ".join(where) if where else "") + " LIMIT @row_limit"
    params.append(("row_limit", "INT64", str(a.limit)))
    return sql, params


def normalize_row(row: dict) -> dict:
    """A result row with plain Python values: `regions` is a list and the address of the creative's page is added."""
    out = dict(row)
    regions = out.get("regions")
    out["regions"] = [str(x) for x in regions] if isinstance(regions, list) else []
    if out.get("advertiser_id") and out.get("creative_id"):
        out["creative_page_url"] = LIBRARY_URL.format(advertiser_id=out["advertiser_id"], creative_id=out["creative_id"])
    return out


class ClientBackend:
    """Queries through the `google-cloud-bigquery` client (Application Default Credentials)."""

    name = "client"

    def __init__(self, client, bigquery):
        self.client, self.bigquery = client, bigquery

    def _params(self, params):
        return [self.bigquery.ScalarQueryParameter(n, t, int(v) if t == "INT64" else v) for n, t, v in params]

    def estimate(self, sql, params) -> int:
        """Bytes the query would bill (dry run, free)."""
        cfg = self.bigquery.QueryJobConfig(query_parameters=self._params(params), dry_run=True, use_query_cache=False)
        return int(self.client.query(sql, job_config=cfg).total_bytes_processed or 0)

    def run(self, sql, params, max_bytes) -> list[dict]:
        """Rows of the query, billing at most `max_bytes`."""
        cfg = self.bigquery.QueryJobConfig(query_parameters=self._params(params), maximum_bytes_billed=max_bytes)
        return [normalize_row(dict(r.items())) for r in self.client.query(sql, job_config=cfg).result()]


class BqCliBackend:
    """Queries through the `bq` CLI of the Google Cloud SDK (credentials of `gcloud auth login`)."""

    name = "bq"

    def __init__(self, project, runner=subprocess.run):
        self.project, self.runner = project, runner

    def _args(self, sql, params, extra):
        proj = [f"--project_id={self.project}"] if self.project else []
        return ["bq", "query", "--use_legacy_sql=false", *proj, *extra, *[f"--parameter={n}:{t}:{v}" for n, t, v in params], sql]

    def _fail(self, res):
        return RuntimeError(((res.stderr or res.stdout).strip().splitlines() or ["bq: brak odpowiedzi"])[-1][:300])

    def estimate(self, sql, params) -> int:
        """Bytes the query would bill (dry run, free)."""
        res = self.runner(self._args(sql, params, ["--dry_run"]), capture_output=True, text=True, timeout=120)
        m = re.search(r"process (\d+) bytes", (res.stdout or "") + (res.stderr or ""))
        if res.returncode != 0 or not m:
            raise self._fail(res)
        return int(m.group(1))

    def run(self, sql, params, max_bytes) -> list[dict]:
        """Rows of the query, billing at most `max_bytes`."""
        res = self.runner(self._args(sql, params, ["--format=json", f"--maximum_bytes_billed={max_bytes}"]), capture_output=True, text=True, timeout=600)
        if res.returncode != 0:
            raise self._fail(res)
        return [normalize_row(r) for r in json.loads(res.stdout or "[]")]


def pick_tier(a, backend) -> tuple[str, str, list, int]:
    """(level, SQL, parameters, estimated bytes) of the richest level of detail that fits into the limit.

    Raises OverLimit with the estimate of the leanest level when even that one does not fit.
    """
    leanest = 0
    for level, columns in TIERS:
        sql, params = build_query(a, columns)
        estimated = backend.estimate(sql, params)
        if estimated <= a.max_bytes:
            return level, sql, params, estimated
        leanest = estimated
    raise OverLimit(leanest, a.max_bytes)


def gcloud_project() -> str | None:
    """Project of the environment (GOOGLE_CLOUD_PROJECT) or of the gcloud configuration; None when unknown."""
    if os.environ.get("GOOGLE_CLOUD_PROJECT"):
        return os.environ["GOOGLE_CLOUD_PROJECT"]
    if not shutil.which("gcloud"):
        return None
    r = subprocess.run(["gcloud", "config", "get-value", "project"], capture_output=True, text=True, timeout=30)
    value = r.stdout.strip()
    return value if r.returncode == 0 and value and value != "(unset)" else None


def make_client(project: str | None):
    """(client, bigquery module) when the client library and Application Default Credentials are there, else None."""
    try:
        from google.cloud import bigquery  # noqa: PLC0415 - optional dependency
        from google.auth.exceptions import DefaultCredentialsError  # noqa: PLC0415
    except ImportError:
        return None
    try:
        return bigquery.Client(project=project), bigquery
    except DefaultCredentialsError:
        return None


def check(project: str | None, client_maker=make_client, which=shutil.which) -> dict:
    """Which backend can run queries now: the client with ADC, the `bq` CLI with a project, or none (with the reason)."""
    if client_maker(project):
        return {"ok": True, "backend": "client", "reason": None}
    if which("bq") and project:
        return {"ok": True, "backend": "bq", "reason": None}
    why = "brak poświadczeń ADC dla google-cloud-bigquery" if which("bq") is None else "brak projektu (GOOGLE_CLOUD_PROJECT albo gcloud config set project)"
    return {"ok": False, "backend": None, "reason": why}


def search(a, client_maker=make_client, runner=subprocess.run) -> dict:
    """Runs the search with the best backend and returns the JSON object to print."""
    project = a.project or gcloud_project()
    made = None if a.backend == "bq" else client_maker(project)
    try:
        if made:
            backend = ClientBackend(*made)
        elif a.backend != "client" and shutil.which("bq") and project:
            backend = BqCliBackend(project, runner)
        else:
            raise NoAccess("brak poświadczeń ADC (klient) i brak CLI bq z projektem")
        level, sql, params, estimated = pick_tier(a, backend)
        return {"rows": backend.run(sql, params, a.max_bytes), "backend": backend.name, "bytesEstimated": estimated, "detail": level}
    except ValueError as e:
        return {"error": str(e), "kind": "failed"}
    except OverLimit as e:
        return {"error": f"{e}. Zawęź zapytanie (kraj, daty, nazwa) albo podnieś ADLIB_BQ_MAX_BYTES.", "kind": "over_limit", "bytesEstimated": e.estimated}
    except NoAccess as e:
        return {"error": str(e), "kind": "no_access", "howToGetAccess": ACCESS_HINT}
    except Exception as e:  # upstream failure: report the reason to the caller instead of crashing
        return {"error": f"{type(e).__name__}: {str(e)[:300]}", "kind": "failed"}


def parse_args(argv: list[str]):
    p = argparse.ArgumentParser()
    p.add_argument("--advertiser", default="")
    p.add_argument("--keyword", default="")
    p.add_argument("--creative", default="")
    p.add_argument("--location", default="")
    p.add_argument("--country", default="")
    p.add_argument("--from", dest="start", default="")
    p.add_argument("--to", dest="end", default="")
    p.add_argument("--limit", type=int, default=100)
    p.add_argument("--max-bytes", type=int, default=10 * 1024 ** 3)
    p.add_argument("--regions", default="")
    p.add_argument("--project", default="")
    p.add_argument("--backend", choices=["auto", "client", "bq"], default="auto")
    p.add_argument("--check", action="store_true")
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    a = parse_args(argv)
    out = check(a.project or gcloud_project()) if a.check else search(a)
    json.dump(out, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
