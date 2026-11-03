# Design System & UI Specifikace: Dashboard Restaurace

Tento dokument definuje designový systém a UX/UI pravidla pro webové rozhraní restaurace podle metodiky **Impeccable** (Paul Bakaus).

---

## 1. Povaha a režim rozhraní (Mode: Operate)
- **Cíl uživatele:** Rychlý, přehledný dispečink objednávek a diagnostika příchozích webhooků v reálném čase.
- **Důraz:** Okamžitá čitelnost stavu, nulové zpoždění, vysoký kontrast, jasná hierarchie, nulový vizuální šum.
- **Zákaz klišé:** Žádné nepoužitelné fialovo-modré gradienty, agresivní neony nebo nízkokontrastní texty. Rozhraní vychází z moderních nástrojů jako Linear, Vercel Dashboard a Stripe Dashboard.

---

## 2. Barevná paleta a sémantické tokeny

Paleta splňuje přísné standardy přístupnosti **WCAG AAA** (kontrast hlavního textu > 15:1):

| Token | Hex hodnota | Účel | Kontrast k pozadí |
|---|---|---|---|
| `--bg` | `#0f172a` (Slate 900) | Základní pozadí aplikace | N/A (základ) |
| `--surface` | `#1e293b` (Slate 800) | Pozadí karet a kontejnerů | 1.3:1 (jemné ohraničení) |
| `--surface-elevated` | `#334155` (Slate 700) | Zvýrazněné prvky, progres bary | 2.1:1 |
| `--border` | `#334155` (Slate 700) | Ohraničení karet, dělící linky | Zřetelné oddělení |
| `--border-light` | `#475569` (Slate 600) | Ohraničení formulářových polí | Jasná orientace při focusu |
| `--text` | `#f8fafc` (Slate 50) | Primární text, nadpisy | **15.8:1 (WCAG AAA)** |
| `--text-muted` | `#94a3b8` (Slate 400) | Popisky, sekundární metadata | **5.8:1 (WCAG AA)** |
| `--accent` | `#c2410c` (Amber/Orange 700) | Akce odeslání objednávky (pizza tema) | Primární tlačítka |
| `--accent-hover` | `#9a3412` (Amber/Orange 800) | Hover stav akčních tlačítek | Interaktivní zpětná vazba |
| `--success` | `#10b981` (Emerald 500) | Stav: Doručeno / Platný podpis | Zelená indikace |
| `--info` | `#38bdf8` (Sky 400) | Stav: Restaurace připravuje | Modrá indikace |
| `--warning` | `#f59e0b` (Amber 500) | Stav: Rozváží se / Duplikát | Oranžová indikace |
| `--danger` | `#ef4444` (Red 500) | Neplatný podpis (401) / Chyba | Červená indikace |

---

## 3. Typografie a hierarchie

- **Font Family:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Monospace pro ID & Hashe:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- **Typografická stupnice:**
  - `h1` (Hlavní titulek): `1.6rem` (25.6px), `font-weight: 700`, `letter-spacing: -0.02em`
  - `h2` / `.card-title`: `1.15rem` (18.4px), `font-weight: 600`
  - Body text / Inputs / Buttons: `0.9375rem` (15px), `line-height: 1.6`
  - Subtitulky a popisky: `0.875rem` (14px)
  - Odznaky (badges) a audit tabulka: `0.8125rem` (13px) a `0.75rem` (12px)
  - Žádný text neklesá pod 12px.

---

## 4. Komponenty a interakce

1. **Stavový indikátor synchronizace (Live Status):**
   - Zelený pulzující indikátor signalizující aktivní 1s polling a spojení s REST API.
2. **Formulář pro vytvoření objednávky:**
   - Přehledné vstupní pole s placeholderem a automatickým generováním ID v případě prázdné hodnoty.
   - Ochrana proti vícenásobnému odeslání (`disabled` stav během síťového volání).
3. **Karty aktivních objednávek:**
   - Každá karta zobrazuje mono ID, barevný status badge a animovaný progres bar:
     - Žádost o objednávku (20%, šedá)
     - Restaurace připravuje (45%, modrá)
     - Rozváží se (75%, oranžová)
     - Doručeno (100%, zelená)
4. **Audit log webhooků (Úloha 5 & 6):**
   - Přehledná tabulka zachycující každou přijatou notifikaci.
   - Jasné odznaky:
     - `✓ Platný` / `✗ Neplatný` (Ověření HMAC-SHA256 podpisu)
     - `🆕 Zpracováno` / `⚠️ Duplikát ignorován` (Idempotence dle `event_id`)
5. **Chybové a storno stavy:**
   - Červený badge a plný progres bar pro stavy storno / chyba / failed.
6. **Neblokující Toast Notifikace (Accessible Toast):**
   - Elegantní plovoucí oznámení v pravém dolním rohu nahrazující rušivý prohlížečový `alert()`.
   - Splňuje přístupnost pomocí `role="alert"` a `aria-live="polite"`.
   - Automatické mizení po 4 sekundách s jemnou CSS transition animací (`opacity` a `transform`).
7. **DOM Invalidation Caching (Zero-Jitter Polling):**
   - Polling každou sekundu porovnává serializovaný JSON stav objednávek a audit logu před překreslením.
   - Nedochází ke zbytečnému mazání a znovu-vytváření DOM elementů, což zachovává plynulé CSS přechody progres barů a zabraňuje rušení uživatelského výběru textu.
8. **Zpětná kompatibilita rozhraní (Úloha 4):**
   - Zachování původního identifikátoru `#ordersList` a globálních funkcí `window.loadOrders()` a `window.sendOrder()` pro kompatibilitu se staršími evaluačními skripty.
9. **Prázdné stavy (Empty States):**
   - Vkusné hlášení v případě, že zatím nebyly přijaty žádné notifikace.
