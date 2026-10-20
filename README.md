# OSSA Data

Publiczny kod integratora danych dla OSSA. Dashboard i kod aplikacji są utrzymywane osobno. Repozytorium nie zawiera danych dostępowych, danych użytkowników ani historii sprawdzanych domen.

## Co robi integrator

- Pobiera publiczne ostrzeżenia meteorologiczne IMGW-PIB i Listę Ostrzeżeń CERT Polska oraz oficjalny RSS komunikatów dla użytkowników.
- Waliduje odpowiedzi i zachowuje poprzednią poprawną kopię w razie awarii.
- Zapisuje gotowe kopie do osobnej przestrzeni Cloudflare KV przeznaczonej dla OSSA.
- Dzieli CERT na 8 niemutowalnych części; publikuje wskaźnik wersji dopiero po udanym zapisie kompletu.
- Nie odwiedza domen z listy i nie otrzymuje adresów wpisywanych przez użytkowników.

Harmonogram uruchamia się nominalnie co 5 minut. IMGW aktualizowane jest przy każdym przebiegu, CERT oraz RSS nie częściej niż co 30 minut. Wymagany Node.js 22; workflow instaluje parser XML przez `npm ci --ignore-scripts` z zapisanego lockfile.

Źródła: https://danepubliczne.imgw.pl/api/data/warningsmeteo oraz https://hole.cert.pl/domains/v2/domains.txt i https://moje.cert.pl/advisories/feed/. Zasady źródeł: https://danepubliczne.imgw.pl/apiinfo i https://cert.pl/lista-ostrzezen/.

## Jednorazowa konfiguracja

W Settings → Secrets and variables → Actions dodaj:

| Rodzaj   | Nazwa                        | Wartość                                                                 |
| -------- | ---------------------------- | ----------------------------------------------------------------------- |
| Variable | `CLOUDFLARE_ACCOUNT_ID`      | ID konta Cloudflare                                                     |
| Variable | `CLOUDFLARE_KV_NAMESPACE_ID` | ID namespace KV przypisanego do OSSA                                    |
| Secret   | `CLOUDFLARE_API_TOKEN`       | Token z uprawnieniem Workers KV Storage Edit, ograniczony do konta OSSA |

Token wpisz bezpośrednio w formularzu sekretu GitHub. Nie dodawaj go do kodu, README, issue, logów ani rozmowy. Workflow ma uprawnienia `contents: read` i nie uruchamia się z pull requestów.

Po ustawieniu konfiguracji wybierz Actions → Refresh OSSA public sources → Run workflow. Log zawiera tylko wynik synchronizacji, bez domen sprawdzanych przez użytkowników i bez sekretów.

## Darmowe limity i dostępność

Standardowe runnery publicznych repozytoriów GitHub Actions są bezpłatne. Harmonogram nie jest gwarancją punktualnego wykonania; GitHub może opóźniać zadania. GitHub wyłącza harmonogram po 60 dniach bez aktywności repozytorium — sprawdzaj stan Actions i w razie potrzeby włącz go ponownie.

Nominalny budżet KV to do 768 zapisów na dobę: 288 IMGW, 48 × 9 CERT i 48 RSS. Błędy po częściowym zapisie i ręczne operacje mogą zwiększyć zużycie. Limit darmowego konta KV wynosi 1000 zapisów na dobę i jest współdzielony z innymi projektami. Nie włączaj równoległej kopii integratora ani drugiego harmonogramu w repozytorium aplikacji.

Części CERT wygasają po 4 godzinach. Aplikacja traktuje kopię starszą niż godzinę jako nieaktualną i zwraca `unknown`. Brak domeny na liście nie jest gwarancją bezpieczeństwa. Wynik może być chwilowo nieznany również w czasie propagacji nowej kopii KV.

Dokumentacja: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [harmonogramy](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [limity KV](https://developers.cloudflare.com/kv/platform/limits/).

## Komunikaty RSS

Pobieramy kategorię „Dla użytkowników”, maksymalnie 12 publikacji z ostatnich 30 dni. Tytuł, data publikacji i skrócony opis pochodzą z oficjalnego kanału. HTML, załączniki i zewnętrzne linki w opisach nie są renderowane. Link karty może prowadzić tylko do HTTPS moje.cert.pl/komunikaty/. Nie ustalamy poziomu ryzyka ani czasu obowiązywania oszustwa. Kopia RSS jest aktualna przez 2 godziny. Licencja publikacji: CERT Polska / NASK-PIB, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).

## Hydrologia IMGW
Ostrzeżenia hydrologiczne i meteorologiczne są pobierane niezależnie, a następnie publikowane jednym zapisem w `ossa:weather`. Każde źródło zachowuje własny czas pobrania i stan ostatniej próby. Nieudana próba jednego źródła nie usuwa poprzedniej kopii ani nie blokuje aktualizacji drugiego. Nominalny budżet pozostaje 768 zapisów KV na dobę. GitHub Actions schedule jest best effort, może mieć opóźnienia; stan świeżości musi pozostać widoczny w aplikacji.

## GIOŚ
Raz na godzinę pobierana jest paczka danych stacji, indeksów i pomiarów PM10/PM2.5, publikowana jako `ossa:air` (24 dodatkowe zapisy na dobę, nominalnie 792 łącznie). Cztery równoległe połączenia; częściowe błędy zachowują starsze dane danej stacji z oznaczeniem nieaktualności. Timestampy pomiarów są interpretowane w strefie Europe/Warsaw.

## Publikacje RCB
Publiczna lista gov.pl oraz pełne treści do 10 aktualnych artykułów są odczytywane standardowym parserem HTML. Aktualizacje pozostają przed wcześniejszą treścią. Moduł nie klasyfikuje publikacji jako aktualnych alarmów i nie zgaduje obszarów ani terminów ich obowiązywania. Kopia jest zapisywana we wspólnej paczce `ossa:news` co 15 minut wraz z niezależnym stanem źródła. Łącznie z IMGW, CERT i GIOŚ nominalnie 840 zapisów na dobę.
