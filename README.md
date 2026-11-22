# Bralnik – prototip

Bralnik za otroke z disleksijo. Besedilo bere v slovenščini in sproti označuje besedo, ki jo bere.

- **Glas:** Supertonic 3 (odprt model, licenca Open RAIL-M). Teče v brskalniku na napravi: brez stroškov, brez interneta po prvem prenosu, besedilo ne zapusti naprave.
- **Prvi zagon:** glas (~400 MB) se enkrat prenese s Hugging Face in shrani v brskalnik.
- **Demo brez glasu:** dodaj `?demo=1` na konec naslova strani. Namesto govora se slišijo piski; uporabno za preizkus vmesnika.

## Objava na GitHub Pages (enkratno, ~5 minut)

1. Prijavi se na [github.com](https://github.com) (ali ustvari brezplačen račun).
2. Desno zgoraj **+ → New repository**. Ime npr. `bralnik`, izberi **Public**, klikni **Create repository**.
3. Na strani novega repozitorija klikni povezavo **uploading an existing file**.
4. Odpakiraj `bralnik.zip` na računalniku in **povleci vse datoteke in mape** (index.html, css, js, README.md, .nojekyll) v okno brskalnika. Klikni **Commit changes**.
5. **Settings → Pages**. Pri *Branch* izberi `main` in mapo `/ (root)`, klikni **Save**.
6. Po 1–2 minutah bo bralnik dosegljiv na `https://TVOJE-IME.github.io/bralnik/`.

Posodobitve: v repozitoriju ponovno naložiš spremenjene datoteke (Add file → Upload files).

## Zgradba

| Datoteka | Namen |
|---|---|
| `index.html` | Uporabniški vmesnik |
| `css/style.css` | Videz, teme, pisave |
| `js/app.js` | Bralnik: predvajanje, označevanje, nastavitve |
| `js/text-prep.js` | Priprava slovenskega besedila za govor (števila, formule, stopinje, odstotki, okrajšave) |
| `js/timing.js` | Ocena časa posameznih besed v posnetku |
| `js/tts-worker.js` | Supertonic 3 v ločenem delavcu (ONNX Runtime Web, WebGPU ali WASM) |

Sklepanje modela je prirejeno po uradnem primeru Supertonic (MIT, © 2025 Supertone Inc.).
