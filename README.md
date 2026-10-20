# OSSA Data

Publiczny kod integratora danych dla OSSA. Dashboard i kod aplikacji są utrzymywane osobno. Repozytorium nie zawiera danych dostępowych, danych użytkowników ani historii sprawdzanych domen.

## Co robi integrator

- Pobiera publiczne ostrzeżenia meteorologiczne IMGW-PIB i Listę Ostrzeżeń CERT Polska.
- Waliduje odpowiedzi i zachowuje poprzednią poprawną kopię w razie awarii.
- Zapisuje gotowe kopie do osobnej przestrzeni Cloudflare KV przeznaczonej dla OSSA.
- Dzieli CERT na 8 niemutowalnych części; publikuje wskaźnik wersji dopiero po udanym zapisie kompletu.
- Nie odwiedza domen z listy i nie otrzymuje adresów wpisywanych przez użytkowników.

Harmonogram uruchamia się nominalnie co 5 minut. IMGW aktualizowane jest przy każdym przebiegu, CERT nie częściej niż co 30 minut. Wymagany Node.js 22, bez instalowania dodatkowych pakietów.

Źródła: https://danepubliczne.imgw.pl/api/data/warningsmeteo oraz https://hole.cert.pl/domains/v2/domains.txt. Zasady źródeł: https://danepubliczne.imgw.pl/apiinfo i https://cert.pl/lista-ostrzezen/.

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

Nominalny budżet KV to do 720 zapisów na dobę: 288 IMGW oraz 48 × 9 CERT. Błędy po częściowym zapisie i ręczne operacje mogą zwiększyć zużycie. Limit darmowego konta KV wynosi 1000 zapisów na dobę i jest współdzielony z innymi projektami. Nie włączaj równoległej kopii integratora ani drugiego harmonogramu w repozytorium aplikacji.

Części CERT wygasają po 4 godzinach. Aplikacja traktuje kopię starszą niż godzinę jako nieaktualną i zwraca `unknown`. Brak domeny na liście nie jest gwarancją bezpieczeństwa. Wynik może być chwilowo nieznany również w czasie propagacji nowej kopii KV.

Dokumentacja: [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [harmonogramy](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [limity KV](https://developers.cloudflare.com/kv/platform/limits/).
