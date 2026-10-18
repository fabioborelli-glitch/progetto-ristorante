# RistoOS — PRD

## Problem statement (originale)
Gestionale SaaS multi-tenant per ristoranti, catene e agenzie che gestiscono più locali. Ispirato alle funzionalità standard di mercato (Baliflow / Restaurant Flow), non un clone.
Scelte utente (giugno 2026): MVP = **Prenotazioni + piantina sala** e **Menu digitale + QR ordering + KDS**. **Super-admin agenzia dal day 1**. Pagamenti online rimandati. Nessuna notifica per ora. Nome: RistoOS, UI in italiano.

## Personas
- Super-admin agenzia: crea tenant, invita/crea owner, entra in qualsiasi ristorante
- Owner / Manager: configura locale, sala, menu, QR, team
- Staff (sala/cucina): gestisce tavoli, prenotazioni, KDS
- Cliente finale: prenota online, ordina dal QR al tavolo

## Architettura
- Backend FastAPI + MongoDB (motor). `tenant_id` su ogni collection tenant; scoping via `tq()` + `get_scoped_or_404` (core.py)
- Auth JWT (PyJWT, bcrypt) — access token Bearer + cookie httpOnly; lockout 5 tentativi / 15 min per email
- Ruoli: `platform_role` (superadmin) separato da `tenant_role` (owner > manager > staff). Superadmin impersona via header `X-Tenant-Id`
- Router: `/api/auth`, `/api/admin` (superadmin), `/api/t` (tenant-scoped), `/api/public/{slug}` (anonimo)
- Frontend React (CRA + craco), shadcn/ui, Tailwind, lucide. Font: Cabinet Grotesk + IBM Plex Sans. PWA manifest base
- KDS e sala in polling (4s / 8s), no WebSocket per ora
- Nota tecnica: cartella `src/pages/public` rinominata `src/pages/guest` (webpack ignora `**/public/**`)

## Implementato (17/06/2026)
- Login, sessione, logout, cambio password, lockout brute-force
- Super-admin: lista tenant con contatori, creazione tenant + owner, attiva/sospendi, "Entra come owner", switch
- Dashboard: KPI giorno (prenotazioni, coperti, ordini aperti, incasso), prossime prenotazioni, stato tavoli, piatti top
- Sala: sale multiple, tavoli drag&drop (edit mode, manager+), stato libero/occupato/in attesa conto, sheet tavolo con ordini aperti, badge ordini
- Prenotazioni: lista per giorno, creazione/modifica, stati (in attesa → confermata → seduta → completata, annullata, no show), assegnazione tavolo, link pubblico
- Prenotazione online pubblica `/r/{slug}/prenota` con disponibilità per fascia e capienza per slot
- Menu: categorie (IT/EN), piatti con descrizione, prezzo, allergeni (14 UE), varianti con sovrapprezzo, immagine URL, disponibilità
- QR tavoli: pagina stampabile con QR per tavolo + QR prenotazioni
- Menu cliente `/r/{slug}/menu?t=CODE`: mobile-first, carrello, varianti, note, invio ordine, pagina stato ordine con polling
- KDS `/kds`: dark mode, ticket per stato, bump nuovo → in preparazione → pronto → servito, filtri, beep nuovi ordini, auto "in attesa conto" quando tutti gli ordini del tavolo sono serviti
- Impostazioni: dati locale, fasce orarie, capienza, team (crea/elimina utenti, ruoli ≤ proprio)
- Seed: superadmin + tenant demo "Trattoria da Fabio" con sale, tavoli, menu, prenotazioni

## Implementato (18/06/2026) — iterazione 2
- **Cassa (POS)** `/cassa`: apertura conto per tavolo (aggrega automaticamente gli ordini QR), aggiunta piatti da cassa (con invio in cucina opzionale), sconti % / €, split per piatti (conto separato) e "alla romana" (calcolo quota), incassi contanti / carta / misto con calcolo resto, chiusura conto con numerazione progressiva anno/N, scontrino non fiscale PDF (reportlab, 80mm, senza IVA), preconto, storico e chiusura di giornata per metodo di pagamento. Tavolo → libero alla chiusura di tutti i conti. Dashboard incasso = conti chiusi.
- **Inviti via email** (Resend gestito Emergent): owner/manager invitano staff; super-admin crea tenant con invito owner (o password manuale). Pagina pubblica `/invito/{token}` per attivare account. Token 7 giorni, monouso.
- **Realtime WebSocket** `/api/ws`: hub per tenant; eventi su ordini, tavoli, conti, prenotazioni. KDS, Sala, Cassa, Prenotazioni si aggiornano live (polling di fallback 20–30s). Indicatori "Live".
- **Upload immagini** (Emergent Object Storage): foto piatti e logo da telefono/fotocamera, serviti da `/api/files/{id}`; logo mostrato nel menu cliente.

## Implementato (18/06/2026) — iterazione 3
- **Email prenotazioni** (Resend gestito): ricevuta alla richiesta online, conferma quando lo staff conferma, promemoria automatico alle 10:00 (Europe/Rome) via cron piattaforma `.emergent/crons.yml` → `POST /api/cron/reservation-reminders` (Bearer `WEBHOOK_CRON_SECRET`, idempotente per `X-Webhook-Id`, lavoro in background). Reinvio manuale da scheda prenotazione; indicatori stato email in lista.
- **Stampa scontrini**: stampa di sistema 80mm (HTML print) e Bluetooth ESC/POS via Web Bluetooth (Chrome) con generatore ESC/POS client-side, stampa di prova, auto-stampa alla chiusura conto (impostazione per dispositivo). Il backend è in cloud: nessuna stampa diretta LAN (limite noto).
- **Reparti cucina**: reparti per tenant (default Cucina/Pizzeria/Bar, editor in Impostazioni), assegnazione per categoria o per piatto, righe ordine con `station_id`, stato per reparto (`order.stations`) con derivazione stato ordine, KDS filtrabile per postazione (persistente sul tablet) con bump per reparto.

## Implementato (18/06/2026) — iterazione 4
- **WhatsApp (predisposto, disattivo)**: servizio Twilio in `services/whatsapp.py`, variabili `TWILIO_ACCOUNT_SID/AUTH_TOKEN/WHATSAPP_FROM` (vuote), flag per tenant `whatsapp_enabled` in Impostazioni con stato "non ancora attivo". Conferma/promemoria partono anche su WhatsApp quando configurato. Il cron promemoria considera anche prenotazioni con solo telefono.
- **Tempi di preparazione KDS**: soglie per tenant `kds_warn_minutes` (15) e `kds_alert_minutes` (25) in Impostazioni; ticket con anello giallo "ATTENZIONE" e rosso pulsante "IN RITARDO".
- **Lista d'attesa** `/attesa`: coda con posizione, chiama / accomoda (assegna tavolo → occupato) / no show / annulla, storico giornata, QR + codice per il cliente; pagina pubblica `/r/{slug}/attesa/{code}` con polling che mostra quanti gruppi prima e "Il tuo tavolo è pronto!" (vibrazione). Nessun messaggio inviato (scelta utente). Eventi WS `waitlist_changed`.
- Stripe pagamento al tavolo: rimandato su scelta utente.

## Implementato (18/06/2026) — iterazione 5
- **Ordine rapido cameriere**: da Sala → tavolo → "Prendi comanda": ricerca, categorie, varianti, note per riga, invio in cucina (`POST /api/t/orders`, idempotente per `client_id`, si aggancia al conto aperto, aggiorna tavolo e KDS via WS).
- **Modalità offline per dispositivo (PWA)**: `lib/offline.js` — cache GET `/t/*` in localStorage, coda azioni (comande, avanzamento ordini, stato tavoli, pagamenti/chiusura/modifica conti, lista d'attesa, prenotazioni) con aggiornamenti ottimistici, sync automatica al ritorno rete (evento online + timer 10s), politica "vince il primo che sincronizza" con banner conflitti; banner Offline / Sincronizzazione / Sincronizzato; sessione mantenuta offline (utente in cache); prefetch menu/tavoli/ordini/conti dopo login e dopo ogni sync; service worker `public/sw.js` per app shell (solo build production); pagina QR cliente "Connessione assente, chiedi al personale". Limiti: aprire un nuovo conto richiede rete; i dispositivi non comunicano tra loro senza internet (serve mini-server locale → Fase 3).

## Backlog prioritario
### P0 (prossimo)
- Pagamenti Stripe al tavolo (QR sullo scontrino) — rimandato
- Attivare WhatsApp inserendo le credenziali Twilio
### P1
- Offline "totale" di sala con hub locale (Raspberry/PC) per QR→KDS senza internet
- Apertura conto offline (id locale + riconciliazione)
- Menu multilingua completo, eliminazione tenant, audit log, RT fiscale
### P2 (Fase 2/3 del piano)
- Magazzino + food cost, staff e turni, RBAC granulare, consolidato multi-locale
- Fatturazione elettronica SDI (Acube)
- App nativa camerieri, CRM/fidelity, AI suggerimenti menu

## Test
- Report: /app/test_reports/iteration_1.json … iteration_6.json
- Suite: `cd /app/backend && python -m pytest tests/ -q` (test email possono dare 503 per rate-limit del proxy)
- Credenziali: /app/memory/test_credentials.md

## 2026-10-18 — Fase 1: MAGAZZINO (implementato)
Replica a fasi della piattaforma BaliFlow (fuoricitta) dentro RistoOS. Fonte dati utente: BaliFlow CRM (app.baliflowagency.com, login online@fuoricitta.eu) — 770 ingredienti, ~140 piatti, fornitori.
Prod target: https://ristoos.emergent.host (super-admin fabio.borelli@icloud.com).
Implementato e testato (iteration_6):
- Backend: routers/inventory.py, services/inventory.py. Collezioni: ingredients, suppliers, stock_movements, recipes, inventory_counts.
- Ingredienti (categoria/unità/costo/fornitore/giacenza/min/par/barcode/not_in_pos), fornitori CRUD, movimenti (carico/scarico/spreco/reso/rettifica) atomici con $inc, registra consegna (carico multiplo + aggiorna costo), sessione di conteggio, ricetta piatto→ingredienti, food cost per piatto, statistiche (da riordinare/scorta bassa/sprechi 30gg/valore magazzino).
- Scarico automatico dal venduto: comanda cameriere, QR e CASSA (bills.add_item).
- Frontend: pages/Inventory.jsx (/magazzino), ricetta+food cost in MenuManager, nav Magazzino.
- Permessi: staff può registrare movimenti (sheet read-only), manager/owner gestiscono tutto.
TODO Fase 1 rimanenti:
- Annullo ordine NON ristorna scorta (decisione prodotto, non implementato).
- IMPORT dati reali: 770 ingredienti + fornitori + ~140 piatti da BaliFlow → RistoOS prod (da fare dopo redeploy).
- Redeploy produzione con il nuovo codice prima dell'import.
Prossime fasi richieste dall'utente (replica BaliFlow completa): food cost page, fatture OCR, fornitori avanzati, conto economico, incassi, conversazioni IA WhatsApp, CRM/clienti, base conoscenza, analisi.

## 2026-10-18 — Fase 1b: Ripristino scorte, Food Cost, Fatture OCR (implementato e testato, iteration_7)
- Ripristino scorte: annullo ordine (PATCH /t/orders/{id}/status annullato) ristorna le giacenze scaricate dal venduto, idempotente (movimento 'reso' con order_id). services/inventory.restore_for_order.
- Food Cost: GET /t/food-cost (bulk, require manager) + pagina /food-cost (costo/margine/FC% per piatto, riepilogo, ordinamento). nav-food-cost nascosto a staff.
- Fatture OCR: POST /t/invoices/scan (UploadFile immagine) -> services/ocr.py (Gemini gemini-3-flash-preview via EMERGENT_LLM_KEY) estrae fornitore/data/righe con qty/unit/unit_cost e auto-match ingredienti; POST /t/invoices/apply aggiorna costi, crea nuovi ingredienti, carica giacenze, crea/collega fornitore. UI: sheet 'Scansiona fattura' in Magazzino. Regex fornitore con re.escape.
- Verificato via curl: scan 4 righe + match Pomodoro; apply +10kg e costo 1.2, crea Mozzarella; restore 8.2->9.1 idempotente; special-char supplier 201.
- Redeploy produzione avviato 2026-10-18 (job a103ac66) per portare live Magazzino + queste funzioni PRIMA dell'import dati.

### IMPORT DATI REALI — PENDENTE (prossimo passo)
- Target: tenant DEMO (trattoria-demo) in PRODUZIONE ristoos.emergent.host (scelta utente).
- Da BaliFlow (app.baliflowagency.com, online@fuoricitta.eu): 770 ingredienti (20 categorie) + fornitori + ~140 piatti (18 categorie) con allergeni/prezzi. Senza foto.
- Metodo da decidere: export CSV/Excel da BaliFlow (veloce/affidabile) oppure scraping browser via screenshot_tool (26 pagine inventario + pagine menu).
- Prerequisito: deploy live con nuovi endpoint inventory.
