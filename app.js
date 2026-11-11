// Kampagnenanalyse – Webseite
// Liest die Daten nach dem Login direkt aus Supabase. Ohne Login gibt die
// Datenbank nichts heraus (Row Level Security).
(() => {
  'use strict';

  // ── Feste Regeln des Dashboards ───────────────────────────────────────────
  const MIN_AUSGABE_LISTE = 100;      // Läuft gut / Läuft schlecht
  const MIN_LEADS_TOP = 5;            // Läuft gut
  const MIN_AUSGABE_GALERIE = 50;     // Alle Anzeigen, Vergleichsbasis
  const MIN_AUSGABE_VERGLEICH = 100;  // Noah gegen Neele
  const MIN_AUSGABE_TEUERSTER = 300;  // teuerster Motiv-Typ
  const MIN_LEADS_BESTER = 10;        // günstigster Motiv-Typ
  const ANZAHL_TOP_FLOP = 4;

  const $ = (sel) => document.querySelector(sel);
  const zahl = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const zahl1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const zahl2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const euro = (v) => (v == null || !isFinite(v) ? '–' : `${zahl.format(v)} €`);
  const euro2 = (v) => (v == null || !isFinite(v) ? '–' : `${zahl2.format(v)} €`);
  const prozent = (v) => (v == null || !isFinite(v) ? '–' : `${zahl2.format(v)} %`);
  const datum = (s) => { if (!s) return '–'; const [j, m, t] = String(s).slice(0, 10).split('-'); return `${t}.${m}.${j}`; };
  const median = (werte) => {
    const v = werte.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  // Kleiner Baukasten für sichere Elemente (Text wird nie als HTML eingefügt)
  function h(tag, attrs, ...kinder) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kind of kinder.flat()) {
      if (kind == null || kind === false) continue;
      el.appendChild(typeof kind === 'string' || typeof kind === 'number' ? document.createTextNode(String(kind)) : kind);
    }
    return el;
  }

  // ── Supabase ──────────────────────────────────────────────────────────────
  const K = window.KONFIG || {};
  if (!K.supabaseUrl || !K.supabaseKey || /HIER_/.test(K.supabaseKey)) {
    document.body.textContent = 'Bitte in config.js die Supabase-Adresse und den Publishable key eintragen.';
    return;
  }
  const db = window.supabase.createClient(K.supabaseUrl, K.supabaseKey);

  const zustand = { daten: null, ausgewaehlt: '', motiv: '', tage: 30 };

  async function alleZeilen(abfrage) {
    const zeilen = [];
    for (let ab = 0; ; ab += 1000) {
      const { data, error } = await abfrage().range(ab, ab + 999);
      if (error) throw error;
      zeilen.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    return zeilen;
  }

  async function ladeDaten(tage) {
    const { data: letzte, error: e1 } = await db.from('zahlen_tag').select('datum').order('datum', { ascending: false }).limit(1);
    if (e1) throw e1;
    if (!letzte || !letzte.length) return { leer: true };
    const bis = letzte[0].datum;
    const d = new Date(bis + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - (tage - 1));
    const von = d.toISOString().slice(0, 10);

    // Vorzeitraum für den Vergleich, nur wenn die Daten so weit zurückreichen
    const vd = new Date(von + 'T00:00:00Z');
    vd.setUTCDate(vd.getUTCDate() - tage);
    const vorVon = vd.toISOString().slice(0, 10);
    const vb = new Date(von + 'T00:00:00Z');
    vb.setUTCDate(vb.getUTCDate() - 1);
    const vorBis = vb.toISOString().slice(0, 10);
    const { data: erste } = await db.from('zahlen_tag').select('datum').order('datum', { ascending: true }).limit(1);
    const vorherMoeglich = erste && erste[0] && erste[0].datum <= vorVon;

    const [anzeigen, zahlen, einsch, laeufe, zahlenVorher] = await Promise.all([
      alleZeilen(() => db.from('anzeigen_ansicht').select('*').order('id')),
      alleZeilen(() => db.from('zahlen_tag')
        .select('anzeige_id,datum,ausgaben,impressionen,link_klicks,leads,videoaufrufe_3s,thruplays')
        .gte('datum', von).lte('datum', bis).order('anzeige_id').order('datum')),
      alleZeilen(() => db.from('einschaetzungen').select('*').order('anzeige_id')),
      db.from('sync_laeufe').select('beendet_am').eq('art', 'meta').eq('status', 'fertig').order('beendet_am', { ascending: false }).limit(1),
      vorherMoeglich
        ? alleZeilen(() => db.from('zahlen_tag').select('anzeige_id,datum,ausgaben,leads').gte('datum', vorVon).lte('datum', vorBis).order('anzeige_id').order('datum'))
        : Promise.resolve(null),
    ]);
    let vorher = null;
    if (zahlenVorher) {
      const a = zahlenVorher.reduce((s, z) => s + (Number(z.ausgaben) || 0), 0);
      const l = zahlenVorher.reduce((s, z) => s + (Number(z.leads) || 0), 0);
      vorher = { ausgaben: a, leads: l, cpl: l ? a / l : null };
    }

    // Zahlen pro Anzeige zusammenzählen
    const summen = new Map();
    for (const z of zahlen) {
      const s = summen.get(z.anzeige_id) || { ausgaben: 0, impressionen: 0, klicks: 0, leads: 0, v3: 0, thru: 0 };
      s.ausgaben += Number(z.ausgaben) || 0;
      s.impressionen += Number(z.impressionen) || 0;
      s.klicks += Number(z.link_klicks) || 0;
      s.leads += Number(z.leads) || 0;
      s.v3 += Number(z.videoaufrufe_3s) || 0;
      s.thru += Number(z.thruplays) || 0;
      summen.set(z.anzeige_id, s);
    }
    const einschMap = new Map(einsch.map((e) => [e.anzeige_id, e]));
    const rows = anzeigen
      .filter((a) => summen.has(a.id) && summen.get(a.id).ausgaben > 0)
      .map((a) => {
        const s = summen.get(a.id);
        return {
          ...a,
          ausgaben: Math.round(s.ausgaben * 100) / 100,
          impressionen: s.impressionen,
          klicks: s.klicks,
          leads: s.leads,
          v3: s.v3,
          thru: s.thru,
          cpl: s.leads ? s.ausgaben / s.leads : null,
          ctr: s.impressionen ? (100 * s.klicks) / s.impressionen : null,
          cr: s.klicks ? (100 * s.leads) / s.klicks : null,
          cpm: s.impressionen ? (1000 * s.ausgaben) / s.impressionen : null,
          einsch: einschMap.get(a.id) || null,
        };
      });

    // Vergleichswerte (Median der Anzeigen ab 50 €, ohne eigene Stellen)
    const basis = rows.filter((r) => r.art !== 'Eigene Stelle' && r.ausgaben >= MIN_AUSGABE_GALERIE);
    const med = { ctr: median(basis.map((r) => r.ctr)), cr: median(basis.map((r) => r.cr)), cpm: median(basis.map((r) => r.cpm)) };
    const vergleich = (w, m) => (w == null || m == null ? 'unklar' : w >= m * 1.2 ? 'gut' : w <= m * 0.8 ? 'schwach' : 'normal');
    for (const r of rows) {
      r.klick = vergleich(r.ctr, med.ctr);
      r.bewerbung = r.klicks < 20 ? 'unklar' : vergleich(r.cr || 0, med.cr);
      r.auslieferung = r.cpm == null || med.cpm == null ? 'unklar' : r.cpm >= med.cpm * 1.25 ? 'schwach' : r.cpm <= med.cpm * 0.8 ? 'gut' : 'normal';
      r.engpass = r.klick === 'schwach' ? 'wird kaum geklickt'
        : r.bewerbung === 'schwach' ? 'Klicks, aber kaum Bewerbungen'
        : r.auslieferung === 'schwach' ? 'Meta spielt sie teuer aus' : null;
    }

    // Bilder: zeitlich begrenzte Links aus dem privaten Speicher
    const bilder = new Map();
    const pfade = [...new Set(rows.map((r) => r.bild_pfad).filter(Boolean))];
    for (let i = 0; i < pfade.length; i += 100) {
      const { data } = await db.storage.from('motive').createSignedUrls(pfade.slice(i, i + 100), 3600);
      for (const b of data || []) if (b.signedUrl) bilder.set(b.path, b.signedUrl);
    }

    const ausgaben = rows.reduce((s, r) => s + r.ausgaben, 0);
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    return {
      von, bis, rows, med, bilder,
      summe: { ausgaben, leads, cpl: leads ? ausgaben / leads : null },
      abgerufen: laeufe.data && laeufe.data[0] ? laeufe.data[0].beendet_am : null,
      vorher,
    };
  }

  // ── Anzeige-Namen kurz und verständlich ───────────────────────────────────
  function kurzname(r) {
    const typ = String(r.typ || '');
    if (r.region) return `${typ.replace(/ regional$/, '')}, ${r.region}`;
    if (/bundesweit$/.test(typ)) return `${typ.replace(/ bundesweit$/, '')}, bundesweit`;
    let k = String(r.kampagne || '').replace(/^KS24\s*-\s*/, '');
    k = k.replace(/\s*[–-]?\s*\(?\d{1,2}\/\d{1,2}(\/\d{2,4})?\)?/g, ' ');
    k = k.replace(/\s+Kanzleicheck mit Noah\s*$/i, ' ');
    k = k.replace(/\s+[–-]\s*(Neu|SFA|SFW|STB|SB)\s*$/i, '').replace(/\s+(Sfa|SFA|SfA)\s*$/, '');
    return k.replace(/\s+[–-]\s*$/, '').replace(/\s{2,}/g, ' ').trim() || String(r.name || '');
  }
  const STATUS = { ACTIVE: 'aktiv', PAUSED: 'pausiert', ARCHIVED: 'archiviert', DELETED: 'gelöscht', CAMPAIGN_PAUSED: 'Kampagne pausiert', ADSET_PAUSED: 'Anzeigengruppe pausiert', WITH_ISSUES: 'mit Problemen', DISAPPROVED: 'abgelehnt', PENDING_REVIEW: 'in Prüfung' };
  function unterzeile(r) {
    if (r.region) return 'Regionskampagne Kanzleistelle24';
    if (r.typ === 'Kanzleicheck') return 'Kanzleicheck-Video';
    if (/bundesweit$/.test(String(r.typ || ''))) return 'Bundesweite Kampagne Kanzleistelle24';
    const m = String(r.name || '').match(/[-–]\s*([A-D])\s*$/);
    return m ? `${r.typ}, Variante ${m[1]}` : String(r.typ || '');
  }

  // ── Bausteine ─────────────────────────────────────────────────────────────
  const SYMBOL = { stark: '✓', mittel: '–', schwach: '✗', unklar: '?' };
  const chip = (label, urteil) => h('span', {
    class: 'chip' + (urteil === 'stark' ? ' gut' : urteil === 'schwach' ? ' schlecht' : ''),
    title: `${label}: ${urteil || 'unklar'}`,
  }, `${SYMBOL[urteil] || '?'} ${label}`);

  function urteilKosten(r, D) {
    const schnitt = D.summe.cpl;
    if (!schnitt || r.cpl == null) return r.leads === 0 && r.ausgaben >= MIN_AUSGABE_GALERIE ? 'schlecht' : '';
    return r.cpl <= schnitt * 0.8 ? 'gut' : r.cpl >= schnitt * 1.5 ? 'schlecht' : '';
  }

  function karte(r, D) {
    const urteil = urteilKosten(r, D);
    const staerke = r.bewerbung === 'gut' ? 'Viele Bewerbungen pro Klick' : r.klick === 'gut' ? 'Wird oft geklickt' : 'Läuft rund';
    const hinweis = urteil === 'gut' ? h('span', { class: 'hinweis gut' }, staerke)
      : r.engpass ? h('span', { class: 'hinweis schlecht' }, `Hakt: ${r.engpass}`) : null;
    const url = r.bild_pfad && D.bilder.get(r.bild_pfad);
    return h('button', {
      class: 'karte' + (urteil === 'gut' ? ' gut-rand' : urteil === 'schlecht' ? ' schlecht-rand' : ''),
      type: 'button', 'aria-label': `${kurzname(r)}: Details zeigen`, onclick: () => oeffneDetail(r),
    },
      h('span', { class: 'bild' }, url ? h('img', { src: url, alt: '', loading: 'lazy' }) : null),
      h('span', { class: 'karte-text' },
        h('span', { class: 'name' }, kurzname(r)),
        h('span', { class: 'unter' }, unterzeile(r)),
        h('span', { class: 'kpl' },
          h('span', { class: 'wert' + (urteil ? ' ' + urteil : '') }, r.cpl != null ? euro(r.cpl) : 'kein Lead'),
          r.cpl != null ? h('small', null, 'pro Lead') : null),
        h('span', { class: 'fuss' }, h('b', null, zahl.format(r.leads)), r.leads === 1 ? ' Lead für ' : ' Leads für ', h('b', null, euro(r.ausgaben))),
        hinweis,
        r.einsch ? h('span', { class: 'chips' }, chip('Bild', r.einsch.bild_urteil), chip('Text', r.einsch.text_urteil), chip('Benefits', r.einsch.benefits_urteil)) : null,
        r.einsch && r.einsch.fazit ? h('span', { class: 'fazit' }, r.einsch.fazit) : null));
  }

  function oeffneDetail(r) {
    const D = zustand.daten;
    const fenster = $('#detail');
    const url = r.bild_pfad && D.bilder.get(r.bild_pfad);
    const WORT = {
      auslieferung: { gut: 'günstig', normal: 'normal', schwach: 'teuer', unklar: 'unklar' },
      klick: { gut: 'oft', normal: 'normal', schwach: 'selten', unklar: 'unklar' },
      bewerbung: { gut: 'oft', normal: 'normal', schwach: 'selten', unklar: 'zu wenig Klicks' },
    };
    const stufe = (titel, schluessel, wert, schnitt) => {
      const u = r[schluessel];
      return h('div', { class: 'stufe' + (u === 'gut' ? ' gut' : u === 'schwach' ? ' schlecht' : '') },
        h('dt', null, titel),
        h('dd', null, h('div', { class: 'urteil' }, WORT[schluessel][u] || u), h('div', { class: 'klein' }, `${wert}, Schnitt ${schnitt}`)));
    };
    const ue = (Array.isArray(r.ueberschriften) ? r.ueberschriften : []).filter(Boolean);
    const tx = (Array.isArray(r.texte) ? r.texte : []).filter(Boolean);
    const e = r.einsch;
    fenster.replaceChildren(
      h('div', { class: 'detail-kopf' },
        h('div', null, h('p', { class: 'detail-name' }, kurzname(r)),
          h('p', { class: 'detail-unter' }, `${unterzeile(r)}${r.status ? ', ' + (STATUS[r.status] || r.status.toLowerCase()) : ''}`)),
        h('button', { class: 'knopf knopf-hell', type: 'button', onclick: () => fenster.close() }, 'Schließen')),
      h('div', { class: 'detail-inhalt' },
        h('div', null,
          url ? h('img', { src: url, alt: `Motiv der Anzeige ${kurzname(r)}` }) : null,
          r.format === 'Video' ? h('p', { class: 'meta', style: 'margin-top:6px' }, 'Vorschaubild des Videos') : null),
        h('div', null,
          h('dl', { class: 'zahlen' },
            h('div', null, h('dt', null, 'Kosten pro Lead'), h('dd', null, r.cpl != null ? euro(r.cpl) : 'kein Lead')),
            h('div', null, h('dt', null, 'Leads'), h('dd', null, zahl.format(r.leads))),
            h('div', null, h('dt', null, 'Ausgegeben'), h('dd', null, euro(r.ausgaben))),
            h('div', null, h('dt', null, 'Klickrate'), h('dd', null, prozent(r.ctr)))),
          h('h3', { class: 'h3', style: 'margin-top:0' }, 'Wo es laut Zahlen hakt'),
          h('dl', { class: 'trichter' },
            stufe('1. Ausgespielt (CPM)', 'auslieferung', euro2(r.cpm), euro2(D.med.cpm)),
            stufe('2. Geklickt', 'klick', prozent(r.ctr), prozent(D.med.ctr)),
            stufe('3. Beworben pro 100 Klicks', 'bewerbung', r.cr == null ? '–' : zahl1.format(r.cr), D.med.cr == null ? '–' : zahl1.format(D.med.cr))),
          h('h3', { class: 'h3' }, 'Bild, Text und Benefits'),
          e ? [
            h('dl', { class: 'einsch' },
              h('dt', null, chip('Bild', e.bild_urteil)), h('dd', null, e.bild || ''),
              h('dt', null, chip('Text', e.text_urteil)), h('dd', null, e.text || ''),
              h('dt', null, chip('Benefits', e.benefits_urteil)), h('dd', null, e.benefits || '')),
            e.fazit ? h('p', { class: 'fazit-gross' }, e.fazit) : null,
            h('p', { class: 'meta', style: 'margin-top:6px' }, 'Einschätzung von Claude, keine Messung.'),
          ] : h('p', { class: 'notiz' }, 'Für diese Anzeige gibt es noch keine Einschätzung.'),
          h('h3', { class: 'h3' }, ue.length === 1 ? 'Überschrift' : `${ue.length} Überschriften`),
          ue.map((t) => h('p', { class: 'variante' }, t)),
          h('h3', { class: 'h3' }, tx.length === 1 ? 'Anzeigentext' : `${tx.length} Anzeigentexte`),
          tx.map((t) => h('p', { class: 'variante' }, t)),
          h('h3', { class: 'h3' }, 'Weitere Angaben'),
          h('p', { class: 'meta' }, `Link-Klicks ${zahl.format(r.klicks)}, Impressionen ${zahl.format(r.impressionen)}, Leads pro 100 Klicks ${r.cr == null ? '–' : zahl1.format(r.cr)}` +
            (r.format === 'Video' ? `, 3-Sek-Aufrufe ${zahl.format(r.v3)}, ThruPlays ${zahl.format(r.thru)}` : '')),
          h('p', { class: 'meta' }, `Kampagne: ${r.kampagne || '–'}`),
          h('p', { class: 'meta' }, `Anzeigenname: ${r.name}`),
          h('p', { class: 'meta' }, `Zielgruppe: ${r.zielgruppe || '–'}`),
          h('p', { class: 'meta' }, `Budget: ${r.budget || '–'}`))));
    if (!fenster.open) fenster.showModal();
    fenster.scrollTop = 0;
  }

  function veraenderung(jetzt, vorher, mehrIstGut) {
    if (vorher == null || jetzt == null || !isFinite(vorher) || vorher === 0) return null;
    const p = (100 * (jetzt - vorher)) / vorher;
    const tage = zustand.tage;
    if (Math.abs(p) < 1) return h('span', { class: 'veraenderung' }, `etwa gleich wie die ${tage} Tage davor`);
    const besser = mehrIstGut == null ? null : (p > 0) === mehrIstGut;
    return h('span', { class: 'veraenderung' + (besser == null ? '' : besser ? ' gut' : ' schlecht') },
      `${p > 0 ? '↑' : '↓'} ${zahl.format(Math.abs(p))} % zu den ${tage} Tagen davor`);
  }

  const abschnitt = (titel, regel, ...inhalt) => h('section', { class: 'abschnitt' },
    h('div', { class: 'ueberschrift' }, h('h2', null, titel), regel ? h('span', { class: 'regel' }, regel) : null), inhalt);
  const falte = (titel, offen, ontoggle, ...inhalt) => h('details', { class: 'falte', open: offen, ontoggle },
    h('summary', null, titel), h('div', { class: 'falte-innen' }, inhalt));

  // ── Seite zeichnen ────────────────────────────────────────────────────────
  function zeichne() {
    const D = zustand.daten;
    const inhalt = $('#inhalt');
    inhalt.replaceChildren();
    if (!D) return;
    if (D.leer) { inhalt.appendChild(h('p', { class: 'notiz' }, 'Noch keine Daten. Der Abruf von Meta ist vermutlich noch nicht gelaufen.')); return; }

    $('#zeitraum').textContent = `${datum(D.von)} bis ${datum(D.bis)}` + (D.abgerufen ? `, zuletzt abgerufen am ${datum(D.abgerufen)}` : '');
    const ohneEigene = D.rows.filter((r) => r.art !== 'Eigene Stelle');

    // Motiv-Typen
    const typen = new Map();
    for (const r of D.rows) {
      const t = typen.get(r.typ) || { typ: r.typ, ausgaben: 0, leads: 0, anzeigen: 0 };
      t.ausgaben += r.ausgaben; t.leads += r.leads; t.anzeigen += 1;
      typen.set(r.typ, t);
    }
    const typListe = [...typen.values()].map((t) => ({ ...t, cpl: t.leads ? t.ausgaben / t.leads : null }));
    const typOhne = typListe.filter((t) => t.typ !== 'Eigene Stelle' && t.cpl != null);
    const bester = typOhne.filter((t) => t.leads >= MIN_LEADS_BESTER).sort((a, b) => a.cpl - b.cpl)[0];
    const teuerster = typOhne.filter((t) => t.ausgaben >= MIN_AUSGABE_TEUERSTER).sort((a, b) => b.cpl - a.cpl)[0];

    // Noah gegen Neele
    const regionen = new Map();
    for (const r of D.rows) {
      if (!r.region || (r.typ !== 'Video Noah regional' && r.typ !== 'Video Neele regional')) continue;
      const wer = r.typ === 'Video Noah regional' ? 'noah' : 'neele';
      const g = regionen.get(r.region) || { noah: { a: 0, l: 0 }, neele: { a: 0, l: 0 } };
      g[wer].a += r.ausgaben; g[wer].l += r.leads;
      regionen.set(r.region, g);
    }
    let nNoah = 0, nNeele = 0, nGesamt = 0;
    for (const g of regionen.values()) {
      if (g.noah.a < MIN_AUSGABE_VERGLEICH || g.neele.a < MIN_AUSGABE_VERGLEICH) continue;
      nGesamt++;
      const a = g.noah.l / g.noah.a, b = g.neele.l / g.neele.a;
      if (a > b * 1.1) nNoah++; else if (b > a * 1.1) nNeele++;
    }

    // 1) Kennzahlen
    const V = D.vorher;
    inhalt.appendChild(h('dl', { class: 'kennzahlen' },
      h('div', null, h('dt', null, 'Ausgegeben'), h('dd', null, euro(D.summe.ausgaben), V ? veraenderung(D.summe.ausgaben, V.ausgaben, null) : null)),
      h('div', null, h('dt', null, 'Leads'), h('dd', null, zahl.format(D.summe.leads), V ? veraenderung(D.summe.leads, V.leads, true) : null)),
      h('div', null, h('dt', null, 'Kosten pro Lead'), h('dd', null, euro(D.summe.cpl), V ? veraenderung(D.summe.cpl, V.cpl, false) : null))));

    // 2) Drei Erkenntnisse
    const kachel = (titel, wert, text) => h('div', { class: 'kachel' }, h('div', { class: 'k-titel' }, titel), h('div', { class: 'k-wert' }, wert), h('div', { class: 'k-text' }, text));
    inhalt.appendChild(h('div', { class: 'kacheln' },
      kachel('Günstigstes Motiv', bester ? euro(bester.cpl) : '–', bester ? bester.typ : 'zu wenig Daten'),
      kachel('Teuerstes Motiv', teuerster && teuerster !== bester ? euro(teuerster.cpl) : '–', teuerster && teuerster !== bester ? teuerster.typ : 'zu wenig Daten'),
      kachel('Noah gegen Neele', nGesamt ? `${nNoah} : ${nNeele}` : '–', nGesamt ? `Noah war in ${nNoah}, Neele in ${nNeele} von ${nGesamt} Regionen günstiger` : 'zu wenig Daten')));

    // 3) Läuft gut / schlecht
    const top = ohneEigene.filter((r) => r.cpl != null && r.leads >= MIN_LEADS_TOP && r.ausgaben >= MIN_AUSGABE_LISTE)
      .sort((a, b) => a.cpl - b.cpl || b.leads - a.leads).slice(0, ANZAHL_TOP_FLOP);
    const flop = ohneEigene.filter((r) => r.ausgaben >= MIN_AUSGABE_LISTE)
      .sort((a, b) => b.ausgaben / Math.max(b.leads, 1) - a.ausgaben / Math.max(a.leads, 1)).slice(0, ANZAHL_TOP_FLOP);
    const liste = (rows, leer) => (rows.length ? h('div', { class: 'reihe' }, rows.map((r) => karte(r, D))) : h('p', { class: 'notiz' }, leer));
    inhalt.appendChild(h('p', { class: 'legende' }, chip('stark', 'stark'), ' ', chip('mittel', 'mittel'), ' ', chip('schwach', 'schwach'), '  Bild, Text und Benefits sind eine Einschätzung von Claude.'));
    inhalt.appendChild(abschnitt('Läuft gut', `ab ${MIN_LEADS_TOP} Leads und ${euro(MIN_AUSGABE_LISTE)}`, liste(top, 'Im Zeitraum erfüllt noch keine Anzeige diese Bedingungen.')));
    inhalt.appendChild(abschnitt('Läuft schlecht', `ab ${euro(MIN_AUSGABE_LISTE)} Ausgaben`, liste(flop, 'Im Zeitraum hat noch keine Anzeige so viel ausgegeben.')));

    // 4) Motive
    const maxCpl = Math.max(1, ...typOhne.map((t) => t.cpl));
    inhalt.appendChild(abschnitt('Kosten pro Lead je Motiv', `Schnitt ${euro(D.summe.cpl)}, helle Balken unter 10 Leads`,
      h('div', { class: 'balken-liste' }, typOhne.sort((a, b) => a.cpl - b.cpl).map((t) =>
        h('div', { class: 'balken-zeile', title: `${t.typ}: ${zahl.format(t.leads)} Leads für ${euro(t.ausgaben)} aus ${t.anzeigen} Anzeigen` },
          h('span', { class: 'label' }, t.typ),
          h('span', { class: 'balken-spur' + (t.leads < 10 ? ' blass' : '') },
            h('span', { class: 'b', style: `width:${Math.max(1, (72 * t.cpl) / maxCpl).toFixed(1)}%` }),
            h('span', { class: 'v' }, h('b', null, euro(t.cpl)), ` (${zahl.format(t.leads)} Leads)`)))))));

    // 5) Alles Weitere eingeklappt
    const motive = [...new Set(D.rows.map((r) => r.typ))].sort();
    const galerie = D.rows.filter((r) => r.ausgaben >= MIN_AUSGABE_GALERIE && (!zustand.motiv || r.typ === zustand.motiv))
      .sort((a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity) || b.ausgaben - a.ausgaben);
    const auswahl = h('select', { onchange: (e) => { zustand.motiv = e.target.value; zustand.offenGalerie = true; zeichne(); } },
      h('option', { value: '' }, 'Alle Motive'), motive.map((m) => h('option', { value: m, selected: zustand.motiv === m }, m)));
    inhalt.appendChild(falte(`Alle Anzeigen (${galerie.length})`, zustand.offenGalerie, (e) => { zustand.offenGalerie = e.target.open; },
      h('label', { class: 'feld', style: 'display:inline-grid' }, 'Motiv', auswahl),
      h('p', { class: 'notiz' }, `Günstigste zuerst, ab ${euro(MIN_AUSGABE_GALERIE)} Ausgaben.`),
      galerie.length ? h('div', { class: 'galerie' }, galerie.map((r) => karte(r, D))) : h('p', { class: 'notiz' }, 'Für dieses Motiv gibt es keine Anzeige mit genug Ausgaben.')));

    const kampagnen = new Map();
    for (const r of D.rows) {
      const k = kampagnen.get(r.kampagne) || { kampagne: r.kampagne || '–', ausgaben: 0, leads: 0 };
      k.ausgaben += r.ausgaben; k.leads += r.leads;
      kampagnen.set(r.kampagne, k);
    }
    inhalt.appendChild(falte(`Alle Kampagnen (${kampagnen.size})`, false, null,
      h('div', { class: 'tabelle-huelle' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Kampagne'), h('th', { class: 'zahl' }, 'Ausgaben'), h('th', { class: 'zahl' }, 'Leads'), h('th', { class: 'zahl' }, 'Kosten pro Lead'))),
        h('tbody', null, [...kampagnen.values()].sort((a, b) => b.ausgaben - a.ausgaben).map((k) =>
          h('tr', null, h('td', { class: 'kname' }, k.kampagne), h('td', { class: 'zahl' }, euro(k.ausgaben)), h('td', { class: 'zahl' }, zahl.format(k.leads)),
            h('td', { class: 'zahl' }, k.leads ? euro(k.ausgaben / k.leads) : 'kein Lead'))))))));

    inhalt.appendChild(falte('So liest du die Zahlen', false, null,
      h('dl', { class: 'begriffe' },
        h('dt', null, 'Kosten pro Lead'), h('dd', null, 'Ausgaben geteilt durch die Zahl der abgeschickten Formulare.'),
        h('dt', null, 'Grün und rot'), h('dd', null, 'Grün heißt mindestens 20 % günstiger als der Schnitt, rot mindestens 50 % teurer.'),
        h('dt', null, 'Hakt'), h('dd', null, `Vergleich mit dem Median aller Anzeigen ab ${euro(MIN_AUSGABE_GALERIE)}. „Wird kaum geklickt“ deutet auf Bild oder Überschrift, „Klicks, aber kaum Bewerbungen“ auf Text, Angebot oder Formular, „teuer ausgespielt“ darauf, dass Meta die Anzeige als wenig passend einstuft.`),
        h('dt', null, 'Bild, Text, Benefits'), h('dd', null, 'Einschätzung von Claude anhand von Motiv und Anzeigentext. Bei Videos nur anhand des Vorschaubilds.'),
        h('dt', null, 'Was nicht drin ist'), h('dd', null, 'Wenige Leads können Zufall sein, und Leads sagen nichts darüber, wie gut die Bewerber sind. Eigene Stellen von Endlich Mitarbeiter zählen nicht in „Läuft gut“, „Läuft schlecht“ und den Kacheln.'))));
  }

  async function aktualisiere() {
    $('#lade-fehler').hidden = true;
    $('#zeitraum').textContent = 'Daten werden geladen …';
    try {
      zustand.daten = await ladeDaten(zustand.tage);
      zeichne();
    } catch (e) {
      $('#lade-fehler').textContent = `Die Daten konnten nicht geladen werden: ${e.message || e}`;
      $('#lade-fehler').hidden = false;
      $('#zeitraum').textContent = '';
    }
  }

  // ── Anmeldung ─────────────────────────────────────────────────────────────
  function zeige(angemeldet) {
    $('#login').hidden = angemeldet;
    $('#dashboard').hidden = !angemeldet;
    if (angemeldet) aktualisiere();
  }

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = $('#login-fehler');
    fehler.hidden = true;
    const { error } = await db.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#passwort').value });
    if (error) {
      fehler.textContent = /invalid/i.test(error.message) ? 'E-Mail oder Passwort stimmt nicht.' : `Anmeldung fehlgeschlagen: ${error.message}`;
      fehler.hidden = false;
      return;
    }
    $('#passwort').value = '';
    zeige(true);
  });
  $('#abmelden').addEventListener('click', async () => { await db.auth.signOut(); zustand.daten = null; if ($('#detail').open) $('#detail').close(); zeige(false); });
  $('#tage').addEventListener('change', (e) => { zustand.tage = Number(e.target.value) || 30; aktualisiere(); });

  $('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  db.auth.getSession().then(({ data }) => zeige(Boolean(data && data.session)));
})();
