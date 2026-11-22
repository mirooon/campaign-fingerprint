# Źródła metadanych

Rejestr zewnętrznych źródeł, z których narzędzie bierze metadane reklam. Każde źródło jest opcjonalne i domyślnie wyłączone: bez poświadczeń albo narzędzia wpisuje w wyniku powód pominięcia i instrukcję uzyskania dostępu. Późniejsze zadania dopisują tu kolejne sekcje.

## Biblioteki reklam

Wspólny interfejs: `lib/adlib/` (typy `AdRecord`, `AdLibrarySource`; adaptery `meta.ts`, `google.ts`; CLI `bun run adlib`). Opis dla użytkownika: [README.md](../README.md#biblioteki-reklam-jak-uzyskać-dostęp), opis techniczny: [TECHNICAL.md §3.11](TECHNICAL.md). Stan: 22.11.2026.

**Żadna z bibliotek nie daje obietnicy trafień.** Wyszukiwanie w Google Ads Transparency nie dało materiałów dla rodzin kampanii z próbki; adapter jest wartością samą w sobie (nowe materiały do sprawdzenia, rozszerzanie kampanii po reklamodawcy), nie sposobem na znalezienie znanej kampanii.

| Biblioteka | Adres | Dostęp | Warunki i ograniczenia | Sprawdzone |
|---|---|---|---|---|
| **Meta Ad Library** | https://www.facebook.com/ads/library/ | bez klucza przez MetaAdsCollector (MIT, nieoficjalny publiczny endpoint strony): wyszukiwanie po frazie, stronie, kraju i dacie oraz dane DSA po identyfikatorze (płatnik, beneficjent, zasięg w UE); oficjalne API wymaga weryfikacji tożsamości i tokenu (nieużywane w kodzie) | automatyczne odpytywanie strony może naruszać regulamin Mety; endpoint zmienia się bez zapowiedzi; jedno żądanie na sekundę; wyszukiwanie wymaga sieci | 22.11.2026: kod MetaAdsCollector 1.7.2 przeczytany lokalnie (pola `Ad`, `search`); zapytań do Mety nie wysyłano |
| **Google Ads Transparency Center** | https://adstransparency.google.com/; zbiór `bigquery-public-data.google_ads_transparency_center` (tabele `creative_stats`, `removed_creative_stats`) | brak oficjalnego API i bez scrapingu; publiczny zbiór BigQuery (EOG i Turcja); wymaga konta Google z projektem w sandboxie BigQuery (`gcloud auth application-default login`; bez ADC działa CLI `bq`) | zapytania liczone za przetworzone kolumny: sandbox 1 TiB miesięcznie; zbiór nie ma domeny docelowej ani tekstu reklamy, tylko adres strony reklamy w Transparency Center; `removed_creative_stats` nie ma reklamodawcy; warunki zbioru: strona zbioru w BigQuery i Google Cloud Terms (nie analizowane w tym zadaniu) | 22.11.2026: `bq show` (schemat), `bq query --dry_run` (rozmiary kolumn, bez kosztu); prawdziwych zapytań nie uruchamiano |
| **TikTok Commercial Content Library** | https://developers.tiktok.com/ (adres formularza wniosku: do uzupełnienia przez Michała) | API na wniosek (odpowiedź do 2 dni roboczych, według opisu zadania możliwe tylko dla badaczy); po przyznaniu `TIKTOK_CLIENT_KEY` i `TIKTOK_CLIENT_SECRET`; adapter `lib/adlib/tiktok.ts` (token klienta, zapytanie z filtrami kraj, reklamodawca, daty, fraza) | warunki programu dla badaczy (nieczytane); **adres punktów końcowych i pola odpowiedzi z publicznych opisów, nie sprawdzone na żywo**; testy na syntetycznych odpowiedziach | niesprawdzone: w tym zadaniu sieć wolno było użyć tylko do stron X; informacje z opisu zadania |
| **X (repozytorium reklam DSA)** | strona pomocy: https://help.x.com/en/business-and-advertising/ads-transparency (strona zwróciła HTTP 403 przy automatycznym pobraniu, więc jej treści nie czytano) | według wyników wyszukiwania (22.11.2026): „Ads Repository”, uruchomione w 2023 jako centrum przejrzystości DSA; zapytanie po koncie, kraju i zakresie dat w interfejsie albo przez API, wynik to plik CSV (lista: reklamodawca, podmiot finansujący, główne parametry targetowania, wyświetlenia, zasięg, także reklamy zatrzymane; treść reklamy według analizy Mozilli tylko jako adres). **Adapter: import pobranego pliku CSV** (`X_ADS_FILE` albo `--x-file`, `lib/adlib/x.ts`); program niczego nie pobiera z X | tylko reklamy wyświetlane w UE; krytyka działania API i pustych plików CSV (Mozilla Foundation, grupa badawcza UFRJ); Komisja Europejska nałożyła na X karę (grudzień 2025) m.in. za przejrzystość repozytorium i przyjęła plan naprawczy (lipiec 2026) obejmujący dostęp przez API; nazwy kolumn eksportu nie sprawdzono, import dopasowuje je luźno (kilka pisowni na pole) | 22.11.2026: tylko wyszukiwanie (snippety wyników) i próba odczytu strony pomocy X (403); warunków serwisu X nie czytano |

### Google: wyszukiwanie po domenie przez publiczne RPC (B-063, nieoficjalne, domyślnie wyłączone)

Zbiór BigQuery nie ma domeny docelowej, więc wyszukiwanie po domenie jest możliwe tylko przez publiczne RPC strony Transparency Center (`SearchService/SearchCreatives`, `SearchSuggestions`, `https://adstransparency.google.com/anji/_/rpc/…`), bez logowania. Moduł: `lib/adlib/googleRpc.ts`; włączenie: `ADLIB_GOOGLE_RPC=1`; kraj `PL` = kod regionu 2616. **Ryzyka:** usługa jest przeznaczona dla strony, nie dla programów, więc automatyczne odpytywanie może naruszać warunki serwisu Google; format żądania i odpowiedzi może się zmienić albo zostać zablokowany bez zapowiedzi; **format zapisano z publicznych opisów klienta webowego i w tej wersji nie został sprawdzony na żywo** (testy używają syntetycznych odpowiedzi w tym kształcie). Odpowiedź nie niesie pełnego adresu docelowego, więc `landingUrl` rekordu to szukana domena. Rozszerzanie kampanii: `bun run adlib -- expand --campaign <id>` szuka po domenach kampanii (RPC) i po kontach reklamodawców z bibliotek reklam.

### Meta: zapasowe źródła (B-068)

Adapter Mety stoi na MetaAdsCollector (MIT). Zapasowe źródła na wypadek zmiany strony biblioteki, **bez kodu w tej wersji**: [athm793/meta-ads-scraper](https://github.com/athm793/meta-ads-scraper) (Apache-2.0 według opisu zadania; drugi scraper bez klucza, do wyboru konfiguracją po dopisaniu adaptera, który zwróci `AdRecord`; narzędzia nie instalowano i jego wyjścia nie sprawdzano) oraz [facebookresearch/Ad-Library-API-Script-Repository](https://github.com/facebookresearch/Ad-Library-API-Script-Repository) (licencja NOASSERTION): tylko jako wzór nazw pól oficjalnego API (`ad_delivery_start_time`, `ad_creation_time`, `page_id`, `page_name`, `bylines`), bez kopiowania kodu.

### Google: koszt zapytań (pomiar 22.11.2026, `bq query --dry_run`)

BigQuery liczy całe kolumny, nie wiersze, więc o koszcie decyduje lista kolumn, nie filtr. Rozmiary kolumn `creative_stats` (GB = 10⁹ bajtów): `advertiser_id` 3,9; `creative_id` 3,9; `creative_page_url` 16,8; `ad_format_type` 1,0; `advertiser_disclosed_name` 3,8; `advertiser_legal_name` 3,8; `advertiser_location` 0,7; `advertiser_verification_status` 1,7; `ad_funded_by` 0,8; `topic` 3,1; `region_code` 2,3; `first_shown` i `last_shown` po 6,3. Adres strony reklamy adapter składa z dwóch identyfikatorów zamiast czytać `creative_page_url`.

Poziomy szczegółowości (skrypt `scripts/py/google_atc.py` bierze najbogatszy, który mieści się w limicie `ADLIB_BQ_MAX_BYTES`, domyślnie 10 GiB):

| Poziom | Kolumny | Szacunek dla wszystkich reklam jednego `advertiser_id` |
|---|---|---|
| `lean` | identyfikatory, format, kraj reklamodawcy, `ad_funded_by` | 10,4 GB (9,7 GiB) |
| `identity` | + nazwa wyświetlana, nazwa prawna, status weryfikacji | 19,7 GB |
| `regions` | + regiony emisji | 21,9 GB |
| `dates` | + daty pierwszej i ostatniej emisji | 34,5 GB |

Przy domyślnym limicie rekord ma więc identyfikator reklamodawcy, kraj i płatnika, ale bez nazwy prawnej i statusu weryfikacji; żeby je dostać, ustaw `ADLIB_BQ_MAX_BYTES=20GB`. Wyszukiwanie po nazwie reklamodawcy albo frazie wymaga kolumn z nazwami (ok. 18 GB przy poziomie `lean`); zapytanie ponad limit kończy się komunikatem z szacunkiem, bez wykonania.
