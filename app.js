// Kampagnenanalyse – Webseite
// Liest die Daten nach dem Login direkt aus Supabase. Ohne Login gibt die
// Datenbank nichts heraus (Row Level Security).
(() => {
  'use strict';

  // ── Feste Regeln des Dashboards ───────────────────────────────────────────
  const MIN_LEADS_TOP = 5;            // Schritt 2: bringt die meisten Leads
  const MIN_AUSGABE_LISTE = 100;      // Schritt 3: bringt kaum Leads
  const MIN_AUSGABE_GALERIE = 50;     // Schritt 5 und Vergleichsbasis (Schnitt)
  const MIN_AUSGABE_VERGLEICH = 100;  // Noah gegen Neele
  const MIN_AUSGABE_TEUERSTER = 300;  // teuerster Motiv-Typ
  const MIN_LEADS_BESTER = 10;        // günstigster Motiv-Typ
  const MIN_LEADS_SICHER = 10;        // darunter gilt ein Motiv als „wenig Daten“
  const MIN_KLICKS_URTEIL = 20;       // darunter kein Urteil über Leads pro Klick
  const ANZAHL_TOP_FLOP = 4;
  const GALERIE_SEITE = 12;

  const SCHRITTE = [
    { id: 'schritt-ueberblick', kurz: 'Überblick', frage: 'Wie viele Leads sind reingekommen?' },
    { id: 'schritt-gut', kurz: 'Was Leads bringt', frage: 'Welche Anzeigen bringen die meisten Leads, und warum?' },
    { id: 'schritt-schlecht', kurz: 'Was hakt', frage: 'Welche Anzeigen bringen kaum Leads, und woran liegt das?' },
    { id: 'schritt-motive', kurz: 'Motive', frage: 'Welche Motive bringen Leads?' },
    { id: 'schritt-alle', kurz: 'Alle Anzeigen', frage: 'Alle Anzeigen zum Nachschlagen' },
  ];

  const $ = (sel) => document.querySelector(sel);
  const zahl = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
  const zahl1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const zahl2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kompakt = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });
  const ok = (v) => v != null && isFinite(v);
  const z0 = (v) => (ok(v) ? zahl.format(v) : '–');
  const z1 = (v) => (ok(v) ? zahl1.format(v) : '–');
  const euro = (v) => (ok(v) ? `${zahl.format(v)}\u00a0€` : '–');
  const euro2 = (v) => (ok(v) ? `${zahl2.format(v)}\u00a0€` : '–');
  const prozent = (v) => (ok(v) ? `${zahl2.format(v)}\u00a0%` : '–');
  const datum = (s) => { if (!s) return '–'; const [j, m, t] = String(s).slice(0, 10).split('-'); return `${t}.${m}.${j}`; };
  const kurzDatum = (s) => { const [, m, t] = String(s).slice(0, 10).split('-'); return `${t}.${m}.`; };
  const tagObjekt = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00Z');
  const plusTage = (s, n) => { const d = tagObjekt(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const wochentag = (s) => WOCHENTAG[tagObjekt(s).getUTCDay()];
  const leadsWort = (n) => (n === 1 ? 'Lead' : 'Leads');
  const aufzaehlung = (liste) => (liste.length < 2 ? liste.join('') : `${liste.slice(0, -1).join(', ')} und ${liste[liste.length - 1]}`);
  const median = (werte) => {
    const v = werte.filter(ok).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const speicher = {
    lies(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    schreib(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* nicht schlimm */ } },
    weg(k) { try { window.localStorage.removeItem(k); } catch (e) { /* nicht schlimm */ } },
  };
  // Bewegung nur, wenn der Browser sie kann und niemand sie abgestellt hat
  const bewegung = 'IntersectionObserver' in window &&
    !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (bewegung) document.documentElement.classList.add('mit-bewegung');

  // Kleiner Baukasten für sichere Elemente (Text wird nie als HTML eingefügt)
  function h(tag, attrs, ...kinder) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kind of kinder.flat(Infinity)) {
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

  const gemerkteTage = Number(speicher.lies('tage'));
  const zustand = {
    daten: null,
    tage: [7, 30, 90].includes(gemerkteTage) ? gemerkteTage : 30,
    motiv: '',
    sortierung: 'leads',
    galerieAnzahl: GALERIE_SEITE,
  };

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
    const bis = String(letzte[0].datum).slice(0, 10);
    const von = plusTage(bis, -(tage - 1));

    // Vorzeitraum für den Vergleich, nur wenn die Daten so weit zurückreichen
    const vorVon = plusTage(von, -tage);
    const vorBis = plusTage(von, -1);
    const { data: erste } = await db.from('zahlen_tag').select('datum').order('datum', { ascending: true }).limit(1);
    const vorherMoeglich = erste && erste[0] && String(erste[0].datum).slice(0, 10) <= vorVon;

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
      r.bewerbung = r.klicks < MIN_KLICKS_URTEIL ? 'unklar' : vergleich(r.cr || 0, med.cr);
      r.auslieferung = r.cpm == null || med.cpm == null ? 'unklar' : r.cpm >= med.cpm * 1.25 ? 'schwach' : r.cpm <= med.cpm * 0.8 ? 'gut' : 'normal';
    }

    // Leads pro Tag (nur Anzeigen, die im Zeitraum Geld ausgegeben haben)
    const ids = new Set(rows.map((r) => r.id));
    const proTag = new Map();
    for (const z of zahlen) {
      if (!ids.has(z.anzeige_id)) continue;
      const k = String(z.datum).slice(0, 10);
      const t = proTag.get(k) || { leads: 0, ausgaben: 0 };
      t.leads += Number(z.leads) || 0;
      t.ausgaben += Number(z.ausgaben) || 0;
      proTag.set(k, t);
    }
    const verlauf = [];
    for (let k = von; k <= bis; k = plusTage(k, 1)) verlauf.push({ datum: k, ...(proTag.get(k) || { leads: 0, ausgaben: 0 }) });

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
      von, bis, tage, rows, med, bilder, verlauf,
      summe: { ausgaben, leads, cpl: leads ? ausgaben / leads : null },
      gesamt: { impressionen: rows.reduce((s, r) => s + r.impressionen, 0), klicks: rows.reduce((s, r) => s + r.klicks, 0) },
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
    const m = String(r.name || '').match(/[-–]\s*([A-D])\s*$/);
    const variante = m ? `, Variante ${m[1]}` : '';
    if (r.region) return 'Regionskampagne Kanzleistelle24' + variante;
    if (r.typ === 'Kanzleicheck') return 'Kanzleicheck-Video' + variante;
    if (/bundesweit$/.test(String(r.typ || ''))) return 'Bundesweite Kampagne Kanzleistelle24' + variante;
    return String(r.typ || '') + variante;
  }
  const istEigene = (r) => r.art === 'Eigene Stelle' || r.typ === 'Eigene Stelle';

  // ── Diagnose: Warum bringt eine Anzeige Leads oder nicht? ─────────────────
  // Jede Anzeige muss drei Stufen schaffen: gesehen werden, geklickt werden,
  // aus dem Klick einen Lead machen. Jede Stufe wird mit dem Schnitt verglichen.
  const STUFEN = [
    { key: 'auslieferung', titel: 'Gesehen' },
    { key: 'klick', titel: 'Geklickt' },
    { key: 'bewerbung', titel: 'Lead' },
  ];
  const WORT = {
    auslieferung: { gut: 'erreicht viele', normal: 'normal', schwach: 'erreicht wenige', unklar: 'zu wenig Daten' },
    klick: { gut: 'oft geklickt', normal: 'normal', schwach: 'selten geklickt', unklar: 'zu wenig Daten' },
    bewerbung: { gut: 'viele Leads', normal: 'normal', schwach: 'wenige Leads', unklar: 'zu wenig Klicks' },
  };
  const SYMBOL = { gut: '✓', normal: '–', schwach: '✗', unklar: '?' };
  const ETIKETT = { klick: 'Wird kaum geklickt', bewerbung: 'Wenig Leads aus Klicks', auslieferung: 'Teuer ausgespielt' };

  function stufe(r, D, key, titel) {
    const u = r[key];
    const m = D.med;
    const s = { key, titel, urteil: u, wort: WORT[key][u] || u };
    if (u === 'unklar') {
      const satz = key === 'bewerbung'
        ? `Bisher erst ${z0(r.klicks)} ${r.klicks === 1 ? 'Klick' : 'Klicks'}. Für eine sichere Aussage braucht es mindestens ${MIN_KLICKS_URTEIL}.`
        : 'Dafür gibt es noch zu wenige Daten.';
      return { ...s, satz };
    }
    if (key === 'auslieferung') {
      const w = `1.000 Einblendungen kosten hier ${euro2(r.cpm)}, im Schnitt ${euro2(m.cpm)}.`;
      if (u === 'gut') return { ...s, satz: `Meta spielt sie günstig aus. ${w} Fürs gleiche Geld erreicht sie also mehr Menschen.`, kurz: 'Meta spielt sie günstig aus, sie erreicht fürs gleiche Geld mehr Menschen.' };
      if (u === 'schwach') return { ...s, satz: `Meta spielt sie teuer aus. ${w} Fürs gleiche Geld erreicht sie also weniger Menschen.`, kurz: 'Meta spielt sie teuer aus.', tipp: 'Meta hält die Anzeige offenbar für wenig passend. Teste ein neues Motiv oder prüfe, ob die Zielgruppe stimmt.' };
      return { ...s, satz: `${w} Das ist im normalen Bereich.` };
    }
    if (key === 'klick') {
      if (u === 'gut') return { ...s, satz: `${prozent(r.ctr)} der Menschen, die sie sehen, klicken darauf. Im Schnitt sind es ${prozent(m.ctr)}.`, kurz: `Wird oft geklickt: ${prozent(r.ctr)}, im Schnitt ${prozent(m.ctr)}.` };
      if (u === 'schwach') return { ...s, satz: `Nur ${prozent(r.ctr)} der Menschen, die sie sehen, klicken darauf. Im Schnitt sind es ${prozent(m.ctr)}. Bild oder Überschrift machen nicht neugierig genug.`, kurz: 'Sie wird kaum geklickt.', tipp: 'Teste ein auffälligeres Bild oder eine Überschrift, die sofort sagt, worum es geht und was man davon hat.' };
      return { ...s, satz: `${prozent(r.ctr)} der Menschen, die sie sehen, klicken darauf, ähnlich wie im Schnitt (${prozent(m.ctr)}).` };
    }
    // bewerbung: aus Klicks werden Leads
    if (u === 'gut') return { ...s, satz: `Von 100 Klicks werden ${z1(r.cr)} zu Leads. Im Schnitt sind es ${z1(m.cr)}.`, kurz: `Aus Klicks werden viele Leads: ${z1(r.cr)} von 100, im Schnitt ${z1(m.cr)}.` };
    if (u === 'schwach') {
      const satz = r.leads === 0
        ? `Aus ${z0(r.klicks)} Klicks ist noch kein einziger Lead geworden. Im Schnitt werden ${z1(m.cr)} von 100 Klicks zu Leads. Wer klickt, wird von Text, Angebot oder Formular nicht überzeugt.`
        : `Von 100 Klicks werden nur ${z1(r.cr)} zu Leads, im Schnitt sind es ${z1(m.cr)}. Wer klickt, wird von Text, Angebot oder Formular nicht überzeugt.`;
      return { ...s, satz, kurz: 'Wer klickt, bewirbt sich selten.', tipp: 'Stell die Benefits weiter nach vorne, schreib den Text konkreter und halte das Formular so kurz wie möglich.' };
    }
    return { ...s, satz: `Von 100 Klicks werden ${z1(r.cr)} zu Leads, ähnlich wie im Schnitt (${z1(m.cr)}).` };
  }

  function diagnose(r, D) {
    if (r._diagnose) return r._diagnose;
    const stufen = STUFEN.map((s) => stufe(r, D, s.key, s.titel));
    const nach = (k) => stufen.find((s) => s.key === k);
    const e = r.einsch;
    const claude = e ? [['Bild', e.bild_urteil], ['Text', e.text_urteil], ['Benefits', e.benefits_urteil]] : [];
    r._diagnose = {
      stufen,
      // Reihenfolge = was zuerst angegangen werden sollte
      schwaechen: ['klick', 'bewerbung', 'auslieferung'].map(nach).filter((s) => s.urteil === 'schwach'),
      staerken: ['bewerbung', 'klick', 'auslieferung'].map(nach).filter((s) => s.urteil === 'gut'),
      claudeSchwach: claude.filter((c) => c[1] === 'schwach').map((c) => c[0]),
      claudeStark: claude.filter((c) => c[1] === 'stark').map((c) => c[0]),
    };
    return r._diagnose;
  }

  // Leads fürs Geld im Vergleich zum Schnitt: 'gut', 'schlecht' oder ''
  function kostenUrteil(r, D) {
    const schnitt = D.summe.cpl;
    if (!schnitt || r.cpl == null) return r.leads === 0 && r.ausgaben >= MIN_AUSGABE_GALERIE ? 'schlecht' : '';
    return r.cpl <= schnitt * 0.8 ? 'gut' : r.cpl >= schnitt * 1.5 ? 'schlecht' : '';
  }

  // ── Bausteine ─────────────────────────────────────────────────────────────
  const CLAUDE_SYMBOL = { stark: '✓', mittel: '–', schwach: '✗' };
  const chip = (label, urteil) => h('span', { class: 'chip' + (urteil === 'stark' || urteil === 'schwach' ? ' ' + urteil : ''), title: `${label}: ${urteil || 'unklar'}` },
    `${CLAUDE_SYMBOL[urteil] || '?'} ${label}`);
  const claudeZeile = (e) => (e ? h('span', { class: 'claude' }, 'Claude:', chip('Bild', e.bild_urteil), chip('Text', e.text_urteil), chip('Benefits', e.benefits_urteil)) : null);

  function ampel(d) {
    const teile = [];
    d.stufen.forEach((s, i) => {
      if (i) teile.push(h('span', { class: 'ampel-pfeil', 'aria-hidden': 'true' }, '›'));
      teile.push(h('span', { class: 'ampel-stufe ' + s.urteil, title: `${s.titel}: ${s.wort}` },
        h('span', { 'aria-hidden': 'true' }, SYMBOL[s.urteil] || '?'), ` ${s.titel}`, h('span', { class: 'nur-sr' }, `: ${s.wort}`)));
    });
    return h('span', { class: 'ampel' }, teile);
  }

  function bild(r, D, marke, ganz) {
    const url = r.bild_pfad && D.bilder.get(r.bild_pfad);
    return h('span', { class: 'anzeige-bild' + (url ? '' : ' leer') + (ganz ? ' ganz' : '') },
      url && ganz ? h('img', { class: 'hintergrund', src: url, alt: '', loading: 'lazy' }) : null,
      url ? h('img', { class: 'motiv', src: url, alt: '', loading: 'lazy' }) : h('span', null, 'Kein Bild'),
      marke ? h('span', { class: 'bild-marke ' + marke[0] }, marke[1]) : null,
      r.format === 'Video' ? h('span', { class: 'video-marke' }, '▶ Video') : null);
  }

  const leadsZeile = (r) => [
    h('span', { class: 'anzeige-leads' }, h('b', null, z0(r.leads)), leadsWort(r.leads)),
    h('span', { class: 'anzeige-kosten' }, r.cpl != null
      ? `${euro(r.cpl)} pro Lead · ${euro(r.ausgaben)} ausgegeben`
      : `${euro(r.ausgaben)} ausgegeben, noch kein Lead`),
  ];

  function warumGut(r, D, d) {
    const punkte = d.staerken.slice(0, 2).map((s) => s.kurz);
    if (!punkte.length) punkte.push('Alle drei Stufen laufen im normalen Bereich. Die vielen Leads kommen vor allem über die Reichweite.');
    if (d.claudeStark.length) punkte.push(`Claude bewertet ${aufzaehlung(d.claudeStark)} als stark.`);
    const teuer = r.cpl != null && D.summe.cpl && r.cpl >= D.summe.cpl * 1.5;
    return h('span', { class: 'warum gut' },
      h('span', { class: 'warum-titel' }, 'Warum sie funktioniert'),
      punkte.map((p) => h('span', { class: 'warum-punkt' }, p)),
      teuer ? h('span', { class: 'warum-hinweis' }, `Aber: Ein Lead kostet hier ${euro(r.cpl)}, im Schnitt ${euro(D.summe.cpl)}.`) : null);
  }

  function warumSchlecht(r, D, d) {
    const haupt = d.schwaechen[0];
    let satz;
    let tipp = haupt && haupt.tipp;
    if (haupt) satz = haupt.satz;
    else if (r.leads === 0) satz = `Sie hat ${euro(r.ausgaben)} ausgegeben und noch keinen Lead gebracht. ${d.stufen[2].urteil === 'unklar' ? d.stufen[2].satz : ''}`.trim();
    else satz = 'Keine Stufe fällt allein aus dem Rahmen. Mehrere kleine Schwächen zusammen sorgen dafür, dass wenig Leads ankommen.';
    if (!tipp && d.claudeSchwach.length) tipp = `Claude sieht Schwächen bei ${aufzaehlung(d.claudeSchwach)}. Mehr dazu in der ganzen Auswertung.`;
    if (!tipp) tipp = 'Vergleiche sie mit den Anzeigen aus Schritt 2 und übernimm, was dort funktioniert.';
    const weitere = d.schwaechen.slice(1).map((s) => s.kurz);
    return h('span', { class: 'warum schlecht' },
      h('span', { class: 'warum-titel' }, 'Woran es liegt'),
      h('span', { class: 'warum-punkt' }, satz),
      weitere.length ? h('span', { class: 'warum-punkt' }, `Außerdem: ${weitere.join(' ')}`) : null,
      h('span', { class: 'tipp' }, h('b', null, 'Tipp: '), tipp));
  }

  function grosseKarte(r, D, art, i) {
    const d = diagnose(r, D);
    return h('button', { class: `anzeige anzeige-gross eintritt ${art}`, style: `--i:${i}`, type: 'button', onclick: () => oeffneDetail(r) },
      bild(r, D, null, true),
      h('span', { class: 'anzeige-text' },
        h('span', { class: 'anzeige-name' }, kurzname(r)),
        h('span', { class: 'anzeige-unter' }, unterzeile(r)),
        leadsZeile(r),
        ampel(d),
        art === 'gut' ? warumGut(r, D, d) : warumSchlecht(r, D, d),
        claudeZeile(r.einsch),
        h('span', { class: 'mehr' }, 'Ganze Auswertung ansehen ', h('span', { class: 'pfeil', 'aria-hidden': 'true' }, '→'))));
  }

  function kleineKarte(r, D) {
    const d = diagnose(r, D);
    const ku = kostenUrteil(r, D);
    const haupt = d.schwaechen[0];
    const marke = haupt ? ['schlecht', ETIKETT[haupt.key]]
      : r.leads === 0 ? ['schlecht', 'Noch kein Lead']
        : ku === 'gut' ? ['gut', 'Günstige Leads'] : null;
    return h('button', { class: `anzeige anzeige-klein ${ku}`, type: 'button', onclick: () => oeffneDetail(r) },
      bild(r, D, marke),
      h('span', { class: 'anzeige-text' },
        h('span', { class: 'anzeige-name' }, kurzname(r)),
        h('span', { class: 'anzeige-unter' }, unterzeile(r)),
        leadsZeile(r),
        ampel(d),
        claudeZeile(r.einsch)));
  }

  // Veränderung zum Vorzeitraum, z. B. „↑ 12 % mehr als die 30 Tage davor“
  function delta(jetzt, vorher, mehrIstGut, woerter, lang) {
    if (!ok(vorher) || !ok(jetzt) || vorher === 0) return null;
    const p = (100 * (jetzt - vorher)) / vorher;
    const davor = `die ${zustand.daten.tage} Tage davor`;
    if (Math.abs(p) < 1) return h('span', { class: 'delta' }, lang ? `etwa gleich wie ${davor}` : 'etwa gleich');
    const besser = (p > 0) === mehrIstGut;
    return h('span', { class: 'delta ' + (besser ? 'gut' : 'schlecht'), title: `${zahl.format(Math.abs(p))} % ${p > 0 ? woerter[0] : woerter[1]} als ${davor}` },
      `${p > 0 ? '↑' : '↓'} ${zahl.format(Math.abs(p))}\u00a0% ${p > 0 ? woerter[0] : woerter[1]}${lang ? ` als ${davor}` : ''}`);
  }

  // Zahl, die beim ersten Erscheinen hochzählt
  const zaehler = (wert) => h('span', { class: 'zaehler', 'data-ziel': String(wert) }, z0(wert));
  function starteZaehler(wurzel) {
    if (!bewegung) return;
    for (const el of wurzel.querySelectorAll('.zaehler')) {
      const ziel = Number(el.dataset.ziel) || 0;
      const start = performance.now();
      const dauer = 1100;
      const schritt = (jetzt) => {
        const t = Math.min(1, (jetzt - start) / dauer);
        el.textContent = zahl.format(Math.round(ziel * (1 - Math.pow(1 - t, 3))));
        if (t < 1) requestAnimationFrame(schritt);
      };
      requestAnimationFrame(schritt);
    }
  }

  // Tooltip (ein gemeinsamer für alle Diagramme)
  function zeigeTip(inhalt, box) {
    const el = $('#tooltip');
    el.replaceChildren(...inhalt);
    el.hidden = false;
    const b = el.offsetWidth;
    const hoehe = el.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - b - 8, box.left + box.width / 2 - b / 2));
    let y = box.top - hoehe - 10;
    if (y < 70) y = box.bottom + 10;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }
  const versteckeTip = () => { $('#tooltip').hidden = true; };

  function springe(ziel) {
    const el = typeof ziel === 'string' ? document.querySelector(ziel) : ziel;
    if (!el) return;
    el.scrollIntoView({ behavior: bewegung ? 'smooth' : 'auto', block: 'start' });
    const titel = el.querySelector('h2');
    if (titel) { titel.setAttribute('tabindex', '-1'); titel.focus({ preventScroll: true }); }
  }
  const sprungLink = (ziel, text, klasse) => h('a', { class: klasse || 'textlink', href: ziel, onclick: (e) => { e.preventDefault(); springe(ziel); } }, text);

  function schritt(nr, titel, einleitung, ...inhalt) {
    const s = SCHRITTE[nr - 1];
    const naechster = SCHRITTE[nr];
    return h('section', { class: 'schritt einblenden', id: s.id, 'aria-labelledby': `${s.id}-titel` },
      h('div', { class: 'schritt-kopf' },
        h('p', { class: 'schritt-nr' }, `Schritt ${nr} von ${SCHRITTE.length}`),
        h('h2', { id: `${s.id}-titel` }, titel),
        einleitung ? h('p', { class: 'schritt-einleitung' }, einleitung) : null),
      inhalt,
      naechster ? h('div', { class: 'weiter' }, sprungLink('#' + naechster.id,
        [`Weiter zu Schritt ${nr + 1}: ${naechster.kurz} `, h('span', { class: 'pfeil', 'aria-hidden': 'true' }, '↓')], 'weiter-knopf')) : null);
  }
  const leer = (text) => h('p', { class: 'leer' }, text);

  // ── Einstieg: So funktioniert der Bericht ─────────────────────────────────
  function einstieg() {
    const zu = () => { $('#einstieg').hidden = true; speicher.schreib('einstieg-weg', '1'); };
    return h('section', { class: 'einstieg', id: 'einstieg', 'aria-label': 'So funktioniert dieser Bericht', hidden: speicher.lies('einstieg-weg') === '1' },
      h('div', null,
        h('p', { class: 'einstieg-titel' }, 'So funktioniert dieser Bericht'),
        h('p', { class: 'einstieg-text' }, 'Der Bericht führt dich in fünf Schritten durch die Zahlen. Im Mittelpunkt stehen die Leads. Lies einfach von oben nach unten, oder spring über die Leiste oben direkt zu einem Schritt.')),
      h('ol', { class: 'einstieg-liste' }, SCHRITTE.map((s, i) => h('li', null, h('span', { class: 'nr' }, i + 1), s.frage))),
      h('div', { class: 'einstieg-knoepfe' },
        h('button', { class: 'knopf', type: 'button', onclick: () => { zu(); springe('#schritt-ueberblick'); } }, 'Los geht’s'),
        h('button', { class: 'knopf knopf-rand', type: 'button', onclick: zu }, 'Ausblenden')));
  }

  // ── Auswertung für die Schritte ───────────────────────────────────────────
  function auswerten(D) {
    const ohneEigene = D.rows.filter((r) => !istEigene(r));
    const top = ohneEigene.filter((r) => r.leads >= MIN_LEADS_TOP)
      .sort((a, b) => b.leads - a.leads || (a.cpl ?? Infinity) - (b.cpl ?? Infinity)).slice(0, ANZAHL_TOP_FLOP);
    const topIds = new Set(top.map((r) => r.id));
    const flop = ohneEigene.filter((r) => r.ausgaben >= MIN_AUSGABE_LISTE && !topIds.has(r.id) && (r.cpl == null || !D.summe.cpl || r.cpl > D.summe.cpl))
      .sort((a, b) => b.ausgaben / Math.max(b.leads, 1) - a.ausgaben / Math.max(a.leads, 1) || a.leads - b.leads).slice(0, ANZAHL_TOP_FLOP);

    const typen = new Map();
    for (const r of ohneEigene) {
      const t = typen.get(r.typ) || { typ: r.typ || 'Ohne Motiv', ausgaben: 0, leads: 0, anzeigen: 0 };
      t.ausgaben += r.ausgaben; t.leads += r.leads; t.anzeigen += 1;
      typen.set(r.typ, t);
    }
    const typListe = [...typen.values()].map((t) => ({ ...t, cpl: t.leads ? t.ausgaben / t.leads : null }));
    const leadsOhneEigene = typListe.reduce((s, t) => s + t.leads, 0);
    const meiste = [...typListe].sort((a, b) => b.leads - a.leads)[0] || null;
    const bester = typListe.filter((t) => t.cpl != null && t.leads >= MIN_LEADS_BESTER).sort((a, b) => a.cpl - b.cpl)[0] || null;
    const teuerster = typListe.filter((t) => t.cpl != null && t.ausgaben >= MIN_AUSGABE_TEUERSTER).sort((a, b) => b.cpl - a.cpl)[0] || null;

    // Noah gegen Neele: wer bringt in derselben Region mehr Leads fürs gleiche Geld?
    const regionen = new Map();
    for (const r of D.rows) {
      if (!r.region || (r.typ !== 'Video Noah regional' && r.typ !== 'Video Neele regional')) continue;
      const wer = r.typ === 'Video Noah regional' ? 'noah' : 'neele';
      const g = regionen.get(r.region) || { noah: { a: 0, l: 0 }, neele: { a: 0, l: 0 } };
      g[wer].a += r.ausgaben; g[wer].l += r.leads;
      regionen.set(r.region, g);
    }
    const nn = { noah: 0, neele: 0, gesamt: 0 };
    for (const g of regionen.values()) {
      if (g.noah.a < MIN_AUSGABE_VERGLEICH || g.neele.a < MIN_AUSGABE_VERGLEICH) continue;
      nn.gesamt++;
      const a = g.noah.l / g.noah.a;
      const b = g.neele.l / g.neele.a;
      if (a > b * 1.1) nn.noah++; else if (b > a * 1.1) nn.neele++;
    }
    return { ohneEigene, top, flop, typListe, leadsOhneEigene, meiste, bester, teuerster: teuerster && teuerster !== bester ? teuerster : null, nn };
  }

  // ── Schritt 1: Überblick ──────────────────────────────────────────────────
  function schrittUeberblick(D, A) {
    const n = D.verlauf.length;
    const V = D.vorher;
    const saetze = [`Vom ${datum(D.von)} bis ${datum(D.bis)} sind ${z0(D.summe.leads)} Leads reingekommen, im Schnitt ${z1(D.summe.leads / n)} pro Tag.`];
    if (V && V.leads) {
      const p = (100 * (D.summe.leads - V.leads)) / V.leads;
      saetze.push(Math.abs(p) < 1
        ? `Das sind etwa so viele wie in den ${n} Tagen davor.`
        : `Das sind ${zahl.format(Math.abs(p))}\u00a0% ${p > 0 ? 'mehr' : 'weniger'} als in den ${n} Tagen davor (${z0(V.leads)}).`);
    }
    const staerkster = D.verlauf.reduce((m, t) => (t.leads > m.leads ? t : m), D.verlauf[0]);
    if (staerkster && staerkster.leads > 0) saetze.push(`Der stärkste Tag war ${wochentag(staerkster.datum)}, der ${datum(staerkster.datum)}, mit ${z0(staerkster.leads)} ${leadsWort(staerkster.leads)}.`);

    const held = h('div', { class: 'held' },
      h('p', { class: 'held-label' }, 'Leads im Zeitraum'),
      h('p', { class: 'held-zahl' }, zaehler(D.summe.leads)),
      V ? delta(D.summe.leads, V.leads, true, ['mehr', 'weniger'], true) : null,
      h('p', { class: 'held-satz' }, saetze.join(' ')),
      h('dl', { class: 'nebenwerte' },
        h('div', null, h('dt', null, 'Kosten pro Lead'), h('dd', null, euro(D.summe.cpl), V ? delta(D.summe.cpl, V.cpl, false, ['teurer', 'günstiger'], false) : null)),
        h('div', null, h('dt', null, 'Ausgegeben'), h('dd', null, euro(D.summe.ausgaben))),
        h('div', null, h('dt', null, 'Anzeigen'), h('dd', null, z0(D.rows.length)))));

    return schritt(1, 'Wie viele Leads sind reingekommen?',
      'Die große Zahl ist das Wichtigste: alle Bewerbungen, die über die Anzeigen reingekommen sind. Die Grafik daneben zeigt, wie sie sich auf die Tage verteilen.',
      h('div', { class: 'ueberblick' }, held, tagesDiagramm(D)),
      aufEinenBlick(D, A));
  }

  const schoenerSchritt = (x) => {
    if (x <= 1) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const n = x / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  };

  function tagesDiagramm(D) {
    const tage = D.verlauf;
    const n = tage.length;
    const max = Math.max(...tage.map((t) => t.leads), 0);
    const rasterSchritt = schoenerSchritt(Math.max(max, 1) / 4);
    const oben = Math.max(rasterSchritt, Math.ceil(max / rasterSchritt) * rasterSchritt);
    const schnitt = D.summe.leads / n;
    const iMax = tage.findIndex((t) => t.leads === max);

    const raster = [];
    for (let v = 0; v <= oben + 1e-9; v += rasterSchritt) {
      raster.push(h('div', { class: 'rasterlinie' + (v === 0 ? ' basis' : ''), style: `bottom:${(100 * v) / oben}%` }, h('span', null, z0(v))));
    }
    const saeulen = [];
    const slots = tage.map((t, i) => {
      const hoehe = (100 * t.leads) / oben;
      const s = h('span', { class: 'saeule', style: `height:${hoehe}%;transition-delay:${Math.round((i * 500) / n)}ms` });
      saeulen.push(s);
      return h('div', { class: 'slot' },
        t.leads ? s : null,
        i === iMax && max > 0 ? h('span', { class: 'spitze', style: `bottom:calc(${hoehe}% + 4px)` }, z0(t.leads)) : null);
    });
    const saeulenBox = h('div', { class: 'saeulen' }, slots);
    const flaeche = h('div', {
      class: 'saeulen-flaeche', tabindex: '0', role: 'group',
      'aria-label': `Leads pro Tag vom ${datum(D.von)} bis ${datum(D.bis)}. Höchster Wert ${z0(max)} Leads. Mit den Pfeiltasten kannst du einzelne Tage auswählen.`,
    },
    raster, saeulenBox,
    h('div', { class: 'schnitt-linie', style: `bottom:${(100 * schnitt) / oben}%` }));

    let aktiv = -1;
    const markiere = (i) => {
      if (aktiv >= 0 && slots[aktiv]) slots[aktiv].classList.remove('aktiv');
      aktiv = i;
      if (i < 0) { versteckeTip(); return; }
      slots[i].classList.add('aktiv');
      const t = tage[i];
      const slotBox = slots[i].getBoundingClientRect();
      const oberkante = slotBox.bottom - (slotBox.height * t.leads) / oben;
      zeigeTip([
        h('strong', null, `${z0(t.leads)} ${leadsWort(t.leads)}`),
        h('span', null, `${wochentag(t.datum)}, ${datum(t.datum)}`),
        h('span', { class: 'tip-leise' }, `${euro(t.ausgaben)} ausgegeben`),
      ], { left: slotBox.left, width: slotBox.width, top: oberkante, bottom: slotBox.bottom });
    };
    flaeche.addEventListener('pointermove', (e) => {
      const b = saeulenBox.getBoundingClientRect();
      markiere(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - b.left) / b.width) * n))));
    });
    flaeche.addEventListener('pointerleave', () => markiere(-1));
    flaeche.addEventListener('focus', () => markiere(aktiv >= 0 ? aktiv : n - 1));
    flaeche.addEventListener('blur', () => markiere(-1));
    flaeche.addEventListener('keydown', (e) => {
      const ziel = { ArrowLeft: aktiv - 1, ArrowRight: aktiv + 1, Home: 0, End: n - 1 }[e.key];
      if (e.key === 'Escape') { markiere(-1); return; }
      if (ziel == null) return;
      e.preventDefault();
      markiere(Math.max(0, Math.min(n - 1, ziel)));
    });

    // Achse unten: bei einer Woche jeder Tag, sonst fünf gleichmäßig verteilte Tage
    const wenige = n <= 7;
    const marken = wenige ? tage.map((t, i) => i) : [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (n - 1))))];
    const achse = marken.map((i) => {
      const t = tage[i];
      const rand = wenige ? null : i === 0 ? 'erste' : i === n - 1 ? 'letzte' : null;
      const links = (100 * (i + (rand === 'erste' ? 0 : rand === 'letzte' ? 1 : 0.5))) / n;
      return h('span', { class: rand, style: `left:${links}%` }, wenige ? `${wochentag(t.datum).slice(0, 2)}\n${kurzDatum(t.datum)}` : kurzDatum(t.datum));
    });

    return h('figure', { class: 'diagramm' },
      h('div', { class: 'diagramm-kopf' },
        h('p', { class: 'diagramm-titel' }, 'Leads pro Tag'),
        h('p', { class: 'diagramm-legende' }, h('span', { class: 'linien-schluessel', 'aria-hidden': 'true' }), `Schnitt: ${z1(schnitt)} Leads pro Tag`)),
      h('p', { class: 'diagramm-unter' }, h('span', { class: 'nur-maus' }, 'Fahr mit der Maus über einen Tag, um die Zahlen zu sehen.'), h('span', { class: 'nur-touch' }, 'Tipp auf einen Tag, um die Zahlen zu sehen.')),
      flaeche,
      h('div', { class: 'x-achse' + (wenige ? ' zweizeilig' : ''), 'aria-hidden': 'true' }, achse),
      h('details', { class: 'tabelle-ansicht' },
        h('summary', null, 'Als Tabelle zeigen'),
        h('div', { class: 'tabelle-huelle' }, h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Tag'), h('th', { class: 'zahl' }, 'Leads'), h('th', { class: 'zahl' }, 'Ausgaben'))),
          h('tbody', null, [...tage].reverse().map((t) => h('tr', null,
            h('td', null, `${wochentag(t.datum)}, ${datum(t.datum)}`), h('td', { class: 'zahl' }, z0(t.leads)), h('td', { class: 'zahl' }, euro(t.ausgaben)))))))));
  }

  function aufEinenBlick(D, A) {
    const punkte = [];
    const t = A.top[0];
    if (t) punkte.push(['gut', '✓', `Die meisten Leads bringt „${kurzname(t)}“: ${z0(t.leads)} ${leadsWort(t.leads)}.`, '#schritt-gut', 'Warum? Zu Schritt 2']);
    const f = A.flop[0];
    if (f) {
      const d = diagnose(f, D);
      const grund = d.schwaechen[0] ? ` ${d.schwaechen[0].kurz}` : f.leads === 0 ? ' Sie hat noch keinen Lead gebracht.' : '';
      punkte.push(['schlecht', '✗', `Am wenigsten Leads fürs Geld bringt „${kurzname(f)}“.${grund}`, '#schritt-schlecht', 'Woran liegt es? Zu Schritt 3']);
    }
    if (A.meiste && A.meiste.leads > 0) {
      const anteil = A.leadsOhneEigene ? Math.round((100 * A.meiste.leads) / A.leadsOhneEigene) : null;
      punkte.push(['info', '★', `Das stärkste Motiv ist „${A.meiste.typ}“ mit ${z0(A.meiste.leads)} Leads${anteil != null ? `, ${anteil}\u00a0% aller Leads` : ''}.`, '#schritt-motive', 'Alle Motive: Schritt 4']);
    }
    if (!punkte.length) return null;
    return h('div', { class: 'blick' },
      h('h3', null, 'Das Wichtigste auf einen Blick'),
      h('ul', { class: 'blick-liste' }, punkte.map(([art, sym, text, ziel, link]) => h('li', null,
        h('span', { class: 'symbol ' + art, 'aria-hidden': 'true' }, sym),
        h('div', null, h('p', { class: 'blick-text' }, text), sprungLink(ziel, `${link} →`))))));
  }

  // ── Schritt 2: Was Leads bringt ───────────────────────────────────────────
  function trichterErklaerung(D) {
    const ctr = D.gesamt.impressionen ? (100 * D.gesamt.klicks) / D.gesamt.impressionen : null;
    const cr = D.gesamt.klicks ? (100 * D.summe.leads) / D.gesamt.klicks : null;
    const stufen = [
      ['1. Gesehen', kompakt.format(D.gesamt.impressionen), 'Einblendungen', null, 'Meta zeigt die Anzeige Menschen aus der Zielgruppe.'],
      ['2. Geklickt', z0(D.gesamt.klicks), 'Klicks', `${prozent(ctr)} der Einblendungen`, 'Bild und Überschrift machen neugierig.'],
      ['3. Lead', z0(D.summe.leads), 'Leads', `${z1(cr)} von 100 Klicks`, 'Text, Angebot und Formular überzeugen.'],
    ];
    return h('div', { class: 'trichter-erkl' },
      h('p', { class: 'trichter-titel' }, 'Vorab: So wird aus einer Anzeige ein Lead'),
      h('ol', { class: 'trichter-stufen' }, stufen.map(([nr, wert, einheit, rate, text]) => h('li', { class: 't-stufe' },
        h('p', { class: 't-nr' }, nr),
        h('p', { class: 't-wert' }, wert, h('small', null, einheit)),
        rate ? h('p', { class: 't-rate' }, rate) : null,
        h('p', { class: 't-text' }, text)))),
      h('p', { class: 'trichter-satz' }, 'Eine Anzeige bringt nur dann viele Leads, wenn sie alle drei Stufen schafft. Deshalb vergleichen wir jede Anzeige auf jeder Stufe mit dem Schnitt aller Anzeigen. Grün heißt besser als der Schnitt, rot heißt schlechter. So siehst du, warum sie Leads bringt oder wo sie welche verliert.'));
  }

  function schrittGut(D, A) {
    return schritt(2, 'Welche Anzeigen bringen die meisten Leads?',
      'Erst kurz erklärt, wie aus einer Anzeige ein Lead wird. Danach kommen die Anzeigen mit den meisten Leads, jeweils mit dem Grund, warum sie funktionieren.',
      trichterErklaerung(D),
      A.top.length
        ? h('div', { class: 'karten-reihe' }, A.top.map((r, i) => grosseKarte(r, D, 'gut', i)))
        : leer(`Im Zeitraum hat noch keine Anzeige ${MIN_LEADS_TOP} oder mehr Leads gebracht.`));
  }

  // ── Schritt 3: Was hakt ───────────────────────────────────────────────────
  function schrittSchlecht(D, A) {
    return schritt(3, 'Welche Anzeigen bringen kaum Leads?',
      `Diese Anzeigen haben mindestens ${euro(MIN_AUSGABE_LISTE)} ausgegeben, aber im Verhältnis am wenigsten Leads gebracht. Bei jeder steht, auf welcher Stufe die Leads verloren gehen und was du tun kannst.`,
      A.flop.length
        ? h('div', { class: 'karten-reihe' }, A.flop.map((r, i) => grosseKarte(r, D, 'schlecht', i)))
        : leer(`Gute Nachricht: Keine Anzeige mit mindestens ${euro(MIN_AUSGABE_LISTE)} Ausgaben bringt weniger Leads fürs Geld als der Schnitt.`));
  }

  // ── Schritt 4: Motive ─────────────────────────────────────────────────────
  function schrittMotive(D, A) {
    const erk = (marke, titel, text) => h('div', { class: 'erkenntnis eintritt' }, h('p', { class: 'erk-marke' }, marke), h('p', { class: 'erk-titel' }, titel), h('p', { class: 'erk-text' }, text));
    const karten = [];
    const beides = A.meiste && A.bester && A.meiste.typ === A.bester.typ;
    if (A.meiste && A.meiste.leads > 0) {
      const anteil = A.leadsOhneEigene ? Math.round((100 * A.meiste.leads) / A.leadsOhneEigene) : 0;
      karten.push(erk(beides ? 'Die meisten Leads, auch fürs Geld' : 'Die meisten Leads', `„${A.meiste.typ}“`,
        `${z0(A.meiste.leads)} Leads aus ${A.meiste.anzeigen} ${A.meiste.anzeigen === 1 ? 'Anzeige' : 'Anzeigen'}, das sind ${anteil}\u00a0% aller Leads.` +
        (beides ? ` Ein Lead kostet hier nur ${euro(A.bester.cpl)}, im Schnitt ${euro(D.summe.cpl)}.` : '')));
    }
    if (A.bester && !beides) karten.push(erk('Die meisten Leads fürs Geld', `„${A.bester.typ}“`, `Ein Lead kostet hier ${euro(A.bester.cpl)}, im Schnitt ${euro(D.summe.cpl)}.`));
    if (A.teuerster && A.bester) {
      const faktor = A.teuerster.cpl / A.bester.cpl;
      karten.push(erk('Die wenigsten Leads fürs Geld', `„${A.teuerster.typ}“`, `Ein Lead kostet hier ${euro(A.teuerster.cpl)}. Mit dem gleichen Geld bringt „${A.bester.typ}“ etwa ${faktor >= 10 ? z0(faktor) : z1(faktor)}-mal so viele Leads.`));
    }
    const nn = A.nn;
    karten.push(erk('Noah gegen Neele', nn.gesamt ? `${nn.noah} : ${nn.neele}` : 'Noch kein Vergleich',
      nn.gesamt
        ? `In ${nn.gesamt} Regionen liefen beide Videos mit mindestens ${euro(MIN_AUSGABE_VERGLEICH)}. Noah brachte in ${nn.noah} davon mehr Leads fürs gleiche Geld, Neele in ${nn.neele}${nn.gesamt - nn.noah - nn.neele ? `, in ${nn.gesamt - nn.noah - nn.neele} lagen beide gleichauf` : ''}.`
        : `Dafür müssen in einer Region beide Videos mindestens ${euro(MIN_AUSGABE_VERGLEICH)} ausgegeben haben.`));
    karten.forEach((k, i) => k.style.setProperty('--i', i));

    return schritt(4, 'Welche Motive bringen Leads?',
      'Hier sind alle Anzeigen mit demselben Motiv zusammengezählt. So siehst du, welche Art von Anzeige sich lohnt.',
      h('div', { class: 'erkenntnisse' }, karten),
      motivBalken(A, D));
  }

  function motivBalken(A, D) {
    const liste = [...A.typListe].sort((a, b) => b.leads - a.leads || a.ausgaben - b.ausgaben);
    if (!liste.length) return leer('Im Zeitraum gibt es noch keine Motive mit Ausgaben.');
    const max = Math.max(1, ...liste.map((t) => t.leads));
    return h('div', null,
      h('p', { class: 'unter-titel' }, 'Leads je Motiv'),
      h('div', { class: 'motiv-liste' }, liste.map((t, i) => {
        const unsicher = t.leads < MIN_LEADS_SICHER;
        const zeile = h('button', {
          type: 'button', class: 'motiv-zeile' + (unsicher ? ' unsicher' : ''),
          onclick: () => zeigeMotiv(t.typ),
          'aria-label': `${t.typ}: ${z0(t.leads)} ${leadsWort(t.leads)}${t.cpl != null ? `, ${euro(t.cpl)} pro Lead` : ''}. Anzeigen dieses Motivs zeigen.`,
        },
        h('span', { class: 'motiv-name' }, t.typ),
        h('span', { class: 'motiv-spur' },
          t.leads ? h('span', { class: 'mbalken', style: `width:${((62 * t.leads) / max).toFixed(1)}%;transition-delay:${i * 50}ms` }) : null,
          h('span', { class: 'motiv-wert' },
            h('b', null, `${z0(t.leads)} ${leadsWort(t.leads)}`),
            t.cpl != null ? ` · ${euro(t.cpl)} pro Lead` : ' · noch kein Lead',
            unsicher ? ' · wenig Daten' : '')));
        const tip = () => {
          const b = zeile.getBoundingClientRect();
          zeigeTip([h('strong', null, `${z0(t.leads)} ${leadsWort(t.leads)}`), h('span', null, t.typ),
            h('span', { class: 'tip-leise' }, `${t.anzeigen} ${t.anzeigen === 1 ? 'Anzeige' : 'Anzeigen'} · ${euro(t.ausgaben)} ausgegeben`)],
          { left: b.left, width: Math.min(b.width, 420), top: b.top, bottom: b.bottom });
        };
        zeile.addEventListener('pointerenter', tip);
        zeile.addEventListener('focus', tip);
        zeile.addEventListener('pointerleave', versteckeTip);
        zeile.addEventListener('blur', versteckeTip);
        return zeile;
      })),
      h('p', { class: 'motiv-fuss' }, `Helle Balken: weniger als ${MIN_LEADS_SICHER} Leads, das kann noch Zufall sein. Klick auf ein Motiv, um seine Anzeigen in Schritt 5 zu sehen.`));
  }

  // ── Schritt 5: Alle Anzeigen ──────────────────────────────────────────────
  const galerie = { ziel: null, auswahl: null };
  function zeigeMotiv(typ) {
    zustand.motiv = typ;
    zustand.galerieAnzahl = GALERIE_SEITE;
    if (galerie.auswahl) galerie.auswahl.value = typ;
    zeichneGalerie();
    versteckeTip();
    springe('#schritt-alle');
  }

  const SORTIERUNG = {
    leads: ['Meiste Leads zuerst', (a, b) => b.leads - a.leads || (a.cpl ?? Infinity) - (b.cpl ?? Infinity)],
    guenstig: ['Günstigste Leads zuerst', (a, b) => (a.cpl ?? Infinity) - (b.cpl ?? Infinity) || b.leads - a.leads],
    probleme: ['Probleme zuerst', (a, b) => b.ausgaben / Math.max(b.leads, 1) - a.ausgaben / Math.max(a.leads, 1)],
  };

  function zeichneGalerie() {
    const D = zustand.daten;
    if (!D || !galerie.ziel) return;
    const sortiere = (SORTIERUNG[zustand.sortierung] || SORTIERUNG.leads)[1];
    const liste = D.rows.filter((r) => r.ausgaben >= MIN_AUSGABE_GALERIE && (!zustand.motiv || r.typ === zustand.motiv)).sort(sortiere);
    const sichtbar = liste.slice(0, zustand.galerieAnzahl);
    const rest = liste.length - sichtbar.length;
    galerie.ziel.replaceChildren(
      h('p', { class: 'galerie-info' },
        h('span', null, `${liste.length} ${liste.length === 1 ? 'Anzeige' : 'Anzeigen'} mit mindestens ${euro(MIN_AUSGABE_GALERIE)} Ausgaben${zustand.motiv ? ` und dem Motiv „${zustand.motiv}“` : ''}.`),
        zustand.motiv ? h('button', { class: 'textknopf', type: 'button', onclick: () => { zustand.motiv = ''; galerie.auswahl.value = ''; zeichneGalerie(); } }, 'Alle Motive zeigen') : null),
      liste.length ? h('div', { class: 'galerie' }, sichtbar.map((r) => kleineKarte(r, D))) : leer('Für dieses Motiv gibt es keine Anzeige mit genug Ausgaben.'),
      rest > 0 ? h('div', { class: 'mehr-zeile' }, h('button', {
        class: 'knopf knopf-rand', type: 'button',
        onclick: () => { zustand.galerieAnzahl += GALERIE_SEITE; zeichneGalerie(); },
      }, `${Math.min(rest, GALERIE_SEITE)} weitere zeigen (noch ${rest})`)) : null);
  }

  function schrittAlle(D) {
    const motive = [...new Set(D.rows.map((r) => r.typ).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    if (zustand.motiv && !motive.includes(zustand.motiv)) zustand.motiv = '';
    galerie.auswahl = h('select', { onchange: (e) => { zustand.motiv = e.target.value; zustand.galerieAnzahl = GALERIE_SEITE; zeichneGalerie(); } },
      h('option', { value: '' }, 'Alle Motive'), motive.map((m) => h('option', { value: m, selected: zustand.motiv === m }, m)));
    const sortierung = h('select', { onchange: (e) => { zustand.sortierung = e.target.value; zustand.galerieAnzahl = GALERIE_SEITE; zeichneGalerie(); } },
      Object.entries(SORTIERUNG).map(([k, [text]]) => h('option', { value: k, selected: zustand.sortierung === k }, text)));
    galerie.ziel = h('div');
    zeichneGalerie();

    return schritt(5, 'Alle Anzeigen im Detail',
      'Zum Nachschlagen. Klick auf eine Anzeige, um die ganze Auswertung zu sehen: alle drei Stufen, die Einschätzung von Claude und die Anzeigentexte.',
      h('div', { class: 'werkzeugleiste' }, h('label', { class: 'feld' }, 'Motiv', galerie.auswahl), h('label', { class: 'feld' }, 'Sortieren', sortierung)),
      galerie.ziel,
      kampagnenTabelle(D),
      begriffe());
  }

  function kampagnenTabelle(D) {
    const kampagnen = new Map();
    for (const r of D.rows) {
      const k = kampagnen.get(r.kampagne) || { kampagne: r.kampagne || '–', ausgaben: 0, leads: 0 };
      k.ausgaben += r.ausgaben; k.leads += r.leads;
      kampagnen.set(r.kampagne, k);
    }
    return h('details', { class: 'falte' },
      h('summary', null, `Alle Kampagnen (${kampagnen.size})`),
      h('div', { class: 'falte-innen' }, h('div', { class: 'tabelle-huelle' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Kampagne'), h('th', { class: 'zahl' }, 'Leads'), h('th', { class: 'zahl' }, 'Kosten pro Lead'), h('th', { class: 'zahl' }, 'Ausgaben'))),
        h('tbody', null, [...kampagnen.values()].sort((a, b) => b.leads - a.leads || b.ausgaben - a.ausgaben).map((k) =>
          h('tr', null, h('td', { class: 'kname' }, k.kampagne), h('td', { class: 'zahl' }, z0(k.leads)),
            h('td', { class: 'zahl' }, k.leads ? euro(k.ausgaben / k.leads) : 'kein Lead'), h('td', { class: 'zahl' }, euro(k.ausgaben)))))))));
  }

  function begriffe() {
    const eintraege = [
      ['Lead', 'Ein abgeschicktes Bewerbungsformular. Darum geht es in diesem Bericht.'],
      ['Die drei Stufen', 'Gesehen: Meta zeigt die Anzeige. Geklickt: Jemand klickt drauf. Lead: Jemand schickt das Formular ab. Auf jeder Stufe kann eine Anzeige Leads verlieren.'],
      ['Schnitt', `Der Median aller Anzeigen mit mindestens ${euro(MIN_AUSGABE_GALERIE)} Ausgaben, ohne eigene Stellen. Die Hälfte der Anzeigen liegt darüber, die Hälfte darunter.`],
      ['Grün, grau, rot', 'Grün heißt mindestens 20 % besser als der Schnitt, rot mindestens 20 % schlechter. Bei „Gesehen“ gilt rot ab 25 % teurerer Ausspielung. Grau ist der normale Bereich.'],
      ['Kosten pro Lead', 'Ausgaben geteilt durch Leads. Je niedriger, desto mehr Leads gibt es fürs gleiche Geld.'],
      ['Bild, Text, Benefits', 'Einschätzung von Claude anhand von Motiv und Anzeigentext, keine Messung. Bei Videos nur anhand des Vorschaubilds.'],
      ['Was nicht drin ist', 'Wenige Leads können Zufall sein, und Leads sagen nichts darüber, wie gut die Bewerber sind. Eigene Stellen von Endlich Mitarbeiter zählen in den Schritten 2 bis 4 nicht mit.'],
    ];
    return h('details', { class: 'falte' },
      h('summary', null, 'So liest du die Zahlen'),
      h('div', { class: 'falte-innen' }, h('dl', { class: 'begriffe' }, eintraege.map(([dt, dd]) => [h('dt', null, dt), h('dd', null, dd)]))));
  }

  // ── Detail-Fenster ────────────────────────────────────────────────────────
  function oeffneDetail(r) {
    const D = zustand.daten;
    const fenster = $('#detail');
    const d = diagnose(r, D);
    const url = r.bild_pfad && D.bilder.get(r.bild_pfad);
    const e = r.einsch;
    const ue = (Array.isArray(r.ueberschriften) ? r.ueberschriften : []).filter(Boolean);
    const tx = (Array.isArray(r.texte) ? r.texte : []).filter(Boolean);
    const status = r.status ? STATUS[r.status] || String(r.status).toLowerCase() : null;
    const tipps = d.schwaechen.map((s) => s.tipp).filter(Boolean);

    const ku = kostenUrteil(r, D);
    const schnitt = D.summe.cpl;
    let urteil;
    if (r.cpl == null) urteil = r.ausgaben >= MIN_AUSGABE_GALERIE ? `Hat für ${euro(r.ausgaben)} noch keinen einzigen Lead gebracht.` : 'Hat noch keinen Lead gebracht, ist aber auch erst wenig gelaufen.';
    else if (ku === 'gut') urteil = `Bringt fürs gleiche Geld mehr Leads als der Schnitt: Ein Lead kostet ${euro(r.cpl)}, im Schnitt ${euro(schnitt)}.`;
    else if (ku === 'schlecht') urteil = `Bringt fürs gleiche Geld deutlich weniger Leads als der Schnitt: Ein Lead kostet ${euro(r.cpl)}, im Schnitt ${euro(schnitt)}.`;
    else urteil = `Bringt ungefähr so viele Leads fürs Geld wie der Schnitt: Ein Lead kostet ${euro(r.cpl)}, im Schnitt ${euro(schnitt)}.`;

    fenster.replaceChildren(
      h('div', { class: 'detail-kopf' },
        h('div', null,
          h('p', { class: 'detail-name' }, kurzname(r)),
          h('p', { class: 'detail-unter' }, [unterzeile(r), status].filter(Boolean).join(' · '))),
        h('button', { class: 'knopf knopf-hell', type: 'button', onclick: () => fenster.close() }, 'Schließen')),
      h('div', { class: 'detail-inhalt' },
        h('div', { class: 'detail-links' },
          url ? h('img', { src: url, alt: `Motiv der Anzeige ${kurzname(r)}` }) : h('div', { class: 'anzeige-bild leer' }, h('span', null, 'Kein Bild')),
          r.format === 'Video' ? h('p', { class: 'meta' }, 'Vorschaubild des Videos') : null),
        h('div', null,
          h('div', { class: 'detail-zahlen' },
            h('div', null, h('span', { class: 'dz-wert' }, z0(r.leads)), h('span', { class: 'dz-label' }, `${leadsWort(r.leads)} im Zeitraum`)),
            h('dl', { class: 'dz-neben' },
              h('div', null, h('dt', null, 'Kosten pro Lead'), h('dd', null, r.cpl != null ? euro(r.cpl) : 'kein Lead')),
              h('div', null, h('dt', null, 'Ausgegeben'), h('dd', null, euro(r.ausgaben))),
              h('div', null, h('dt', null, 'Klicks'), h('dd', null, z0(r.klicks))),
              h('div', null, h('dt', null, 'Einblendungen'), h('dd', null, z0(r.impressionen))))),
          h('p', { class: 'detail-urteil ' + ku }, urteil),
          h('h3', { class: 'h3' }, 'Wo die Anzeige Leads gewinnt oder verliert'),
          h('ol', { class: 'diagnose' }, d.stufen.map((s, i) => h('li', { class: 'diag ' + s.urteil },
            h('span', { class: 'diag-symbol', 'aria-hidden': 'true' }, SYMBOL[s.urteil] || '?'),
            h('div', null,
              h('p', { class: 'diag-kopf' }, h('span', { class: 'diag-nr' }, `${i + 1}. ${s.titel}`), h('span', { class: 'diag-wort' }, s.wort)),
              h('p', { class: 'diag-satz' }, s.satz))))),
          tipps.length ? h('div', { class: 'tipp-box' },
            h('p', { class: 'tipp-titel' }, 'Was du tun kannst'),
            tipps.length === 1 ? h('p', null, tipps[0]) : h('ul', null, tipps.map((t) => h('li', null, t)))) : null,
          h('h3', { class: 'h3' }, 'Bild, Text und Benefits laut Claude'),
          e ? [
            h('dl', { class: 'einsch' },
              h('dt', null, chip('Bild', e.bild_urteil)), h('dd', null, e.bild || ''),
              h('dt', null, chip('Text', e.text_urteil)), h('dd', null, e.text || ''),
              h('dt', null, chip('Benefits', e.benefits_urteil)), h('dd', null, e.benefits || '')),
            e.fazit ? h('p', { class: 'fazit-gross' }, e.fazit) : null,
            h('p', { class: 'meta', style: 'margin-top:6px' }, 'Einschätzung von Claude, keine Messung.'),
          ] : h('p', { class: 'notiz' }, 'Für diese Anzeige gibt es noch keine Einschätzung.'),
          ue.length ? [h('h3', { class: 'h3' }, ue.length === 1 ? 'Überschrift' : `${ue.length} Überschriften`), ue.map((t) => h('p', { class: 'variante' }, t))] : null,
          tx.length ? [h('h3', { class: 'h3' }, tx.length === 1 ? 'Anzeigentext' : `${tx.length} Anzeigentexte`), tx.map((t) => h('p', { class: 'variante' }, t))] : null,
          h('details', { class: 'detail-mehr' },
            h('summary', null, 'Weitere Angaben'),
            h('p', { class: 'meta' }, `Leads pro 100 Klicks ${z1(r.cr)}, Klickrate ${prozent(r.ctr)}, 1.000 Einblendungen kosten ${euro2(r.cpm)}` +
              (r.format === 'Video' ? `, 3-Sek-Aufrufe ${z0(r.v3)}, ThruPlays ${z0(r.thru)}` : '')),
            h('p', { class: 'meta' }, `Kampagne: ${r.kampagne || '–'}`),
            h('p', { class: 'meta' }, `Anzeigenname: ${r.name}`),
            h('p', { class: 'meta' }, `Zielgruppe: ${r.zielgruppe || '–'}`),
            h('p', { class: 'meta' }, `Budget: ${r.budget || '–'}`)))));
    versteckeTip();
    if (!fenster.open) fenster.showModal();
    fenster.scrollTop = 0;
  }

  // ── Seite zeichnen ────────────────────────────────────────────────────────
  let beobachter = null;
  function beobachte(wurzel) {
    if (beobachter) beobachter.disconnect();
    const ziele = wurzel.querySelectorAll('.einblenden');
    if (!bewegung) { ziele.forEach((el) => el.classList.add('sichtbar')); return; }
    beobachter = new IntersectionObserver((eintraege) => {
      for (const e of eintraege) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('sichtbar');
        starteZaehler(e.target);
        beobachter.unobserve(e.target);
      }
    }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
    ziele.forEach((el) => beobachter.observe(el));
  }

  function zeichne() {
    const D = zustand.daten;
    const inhalt = $('#inhalt');
    inhalt.classList.remove('laedt');
    versteckeTip();
    if (!D) { inhalt.replaceChildren(); return; }
    if (D.leer) {
      $('#zeitraum').textContent = '';
      inhalt.replaceChildren(leer('Noch keine Daten. Der Abruf von Meta ist vermutlich noch nicht gelaufen.'));
      return;
    }
    $('#zeitraum').textContent = `${datum(D.von)} bis ${datum(D.bis)}` + (D.abgerufen ? ` · zuletzt aktualisiert am ${datum(D.abgerufen)}` : '');
    const A = auswerten(D);
    inhalt.replaceChildren(
      einstieg(),
      schrittUeberblick(D, A),
      schrittGut(D, A),
      schrittSchlecht(D, A),
      schrittMotive(D, A),
      schrittAlle(D));
    beobachte(inhalt);
    aktualisiereLeiste();
    if (alarm.konto) zeichneAlarmLeiste(); // Restlaufzeit braucht die Tageszahlen
  }

  const ladeansicht = () => h('div', { class: 'skelett', 'aria-hidden': 'true' },
    h('div', { class: 'skelett-reihe' }, h('div', { class: 'sk sk-hoch' }), h('div', { class: 'sk sk-hoch' })),
    h('div', { class: 'sk' }));

  async function aktualisiere() {
    $('#lade-fehler').hidden = true;
    $('#zeitraum').textContent = 'Daten werden geladen …';
    const inhalt = $('#inhalt');
    if (zustand.daten) inhalt.classList.add('laedt'); // altes Bild halten, nur abdunkeln
    else inhalt.replaceChildren(ladeansicht());
    try {
      zustand.daten = await ladeDaten(zustand.tage);
      zeichne();
    } catch (e) {
      inhalt.classList.remove('laedt');
      if (!zustand.daten) inhalt.replaceChildren();
      $('#lade-fehler').textContent = `Die Daten konnten nicht geladen werden: ${e.message || e}`;
      $('#lade-fehler').hidden = false;
      $('#zeitraum').textContent = '';
    }
  }

  // ── Schritt-Leiste oben ───────────────────────────────────────────────────
  const leistenLinks = [...document.querySelectorAll('.schritte a')];
  let leisteGeplant = false;
  let letzteAktive = null;
  function aktualisiereLeiste() {
    leisteGeplant = false;
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    $('#fortschritt-balken').style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    let aktivIndex = 0;
    SCHRITTE.forEach((s, i) => {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.4) aktivIndex = i;
    });
    if (max > 0 && window.scrollY >= max - 4) aktivIndex = SCHRITTE.length - 1;
    leistenLinks.forEach((a, i) => {
      a.classList.toggle('aktiv', i === aktivIndex);
      a.classList.toggle('erledigt', i < aktivIndex);
      if (i === aktivIndex) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
    });
    const aktiv = leistenLinks[aktivIndex];
    if (aktiv !== letzteAktive) {
      letzteAktive = aktiv;
      const innen = aktiv.parentElement;
      if (innen.scrollWidth > innen.clientWidth) innen.scrollTo({ left: aktiv.offsetLeft - 16, behavior: bewegung ? 'smooth' : 'auto' });
    }
  }
  window.addEventListener('scroll', () => {
    if (!$('#tooltip').hidden) versteckeTip();
    if (!leisteGeplant) { leisteGeplant = true; requestAnimationFrame(aktualisiereLeiste); }
  }, { passive: true });
  window.addEventListener('resize', () => { versteckeTip(); aktualisiereLeiste(); });
  leistenLinks.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); springe(a.getAttribute('href')); }));
  $('#anleitung').addEventListener('click', () => {
    speicher.weg('einstieg-weg');
    const box = $('#einstieg');
    if (box) { box.hidden = false; window.scrollTo({ top: 0, behavior: bewegung ? 'smooth' : 'auto' }); }
  });

  // ── Zeitraum ──────────────────────────────────────────────────────────────
  const zeitKnoepfe = [...document.querySelectorAll('.zeitwahl button')];
  const zeigeZeitraum = () => zeitKnoepfe.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.tage) === zustand.tage)));
  zeitKnoepfe.forEach((b) => b.addEventListener('click', () => {
    const tage = Number(b.dataset.tage);
    if (tage === zustand.tage) return;
    zustand.tage = tage;
    speicher.schreib('tage', String(tage));
    zeigeZeitraum();
    aktualisiere();
  }));
  zeigeZeitraum();

  // ── Konto-Alarm: Ausgabenlimit erreicht oder Kampagnen offline ───────────
  // Die stündliche Konto-Prüfung (Repo Meta-Analyse-Tool, scripts/konto-check.mjs)
  // legt ihr Ergebnis als _konto/status.json in den privaten Speicher „motive“.
  // Gibt es die Datei noch nicht, passiert hier nichts.
  const PRUEF_ABSTAND_MS = 10 * 60 * 1000;
  const SEITENTITEL = document.title;
  const alarm = { befund: null, konto: null, gezeigt: null, timer: null };

  const zeitpunkt = (iso, zone) => {
    if (!iso) return '–';
    const z = zone || 'Europe/Berlin';
    const tag = (d) => new Intl.DateTimeFormat('de-DE', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const d = new Date(iso);
    const uhr = new Intl.DateTimeFormat('de-DE', { timeZone: z, hour: '2-digit', minute: '2-digit' }).format(d);
    const heute = new Date();
    const gestern = new Date(Date.now() - 864e5);
    if (tag(d) === tag(heute)) return `heute ${uhr} Uhr`;
    if (tag(d) === tag(gestern)) return `gestern ${uhr} Uhr`;
    return `am ${tag(d)} um ${uhr} Uhr`;
  };
  const stundeIn = (iso, zone) => {
    const teile = new Intl.DateTimeFormat('de-DE', { timeZone: zone || 'Europe/Berlin', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(iso));
    return Number((teile.find((t) => t.type === 'hour') || {}).value);
  };

  async function ladeKontoStatus() {
    try {
      const { data, error } = await db.storage.from('motive').download('_konto/status.json');
      if (error || !data) return null;
      const k = JSON.parse(await data.text());
      return k && k.geprueft_am ? k : null;
    } catch (e) {
      return null;
    }
  }

  // Was ist los? Liefert null, wenn alles in Ordnung ist.
  function bewerteKonto(k) {
    const limit = Number(k.ausgabenlimit) || 0;
    const ausgegeben = Number(k.ausgegeben) || 0;
    const status = k.kontostatus == null ? 1 : Number(k.kontostatus);
    const aktive = k.aktive_anzeigen == null ? null : Number(k.aktive_anzeigen);
    const ZAHLUNG = ['Öffne den Meta Werbeanzeigenmanager.', 'Geh links im Menü zu „Abrechnung und Zahlungen“.'];

    if (limit > 0 && ausgegeben >= limit) {
      return {
        stufe: 'alarm', schluessel: 'limit', grund: 'Das Ausgabenlimit des Werbekontos ist erreicht.',
        text: `Im Werbekonto ist ein Ausgabenlimit von ${euro(limit)} eingestellt, und davon sind ${euro(ausgegeben)} ausgegeben. Meta spielt deshalb keine Anzeigen mehr aus. Solange das so bleibt, kommen keine neuen Leads rein.`,
        balken: { ausgegeben, limit },
        schritte: [...ZAHLUNG, 'Öffne die „Zahlungseinstellungen“ und erhöhe beim „Ausgabenlimit für das Konto“ den Betrag, setz es zurück oder entferne es.'],
        nachher: 'Danach laufen die Anzeigen meist innerhalb weniger Minuten wieder an.',
      };
    }
    if (![1, 8, 9].includes(status)) { // 1 aktiv; 8 und 9 laufen noch, siehe Warnung unten
      const TEXT = {
        2: ['Meta hat das Werbekonto deaktiviert.', 'Solange das Konto deaktiviert ist, spielt Meta keine Anzeigen aus.', ['Öffne den Meta Werbeanzeigenmanager und lies die Meldung von Meta oben auf der Seite.', 'Prüf unter „Kontoqualität“, warum das Konto deaktiviert wurde, und leg dort bei Bedarf Einspruch ein.']],
        3: ['Eine Zahlung ist offen oder fehlgeschlagen.', 'Meta hat eine Zahlung nicht einziehen können und spielt deshalb keine Anzeigen mehr aus.', [...ZAHLUNG, 'Begleiche den offenen Betrag oder hinterleg eine funktionierende Zahlungsmethode.']],
        7: ['Meta prüft das Werbekonto gerade.', 'Während der Prüfung spielt Meta keine Anzeigen aus.', ['Öffne den Meta Werbeanzeigenmanager und lies die Meldung von Meta.', 'Prüf unter „Kontoqualität“, ob Meta noch Angaben von dir braucht.']],
        100: ['Das Werbekonto wird gerade geschlossen.', 'Über ein Konto, das geschlossen wird, laufen keine Anzeigen.', ['Prüf im Meta Business Manager, wer das Konto schließen lässt und ob das so gewollt ist.']],
        101: ['Das Werbekonto ist geschlossen.', 'Über ein geschlossenes Konto laufen keine Anzeigen.', ['Prüf im Meta Business Manager, ob das Konto wieder geöffnet werden kann oder ein anderes Konto genutzt werden soll.']],
      }[status] || [`Das Werbekonto ist nicht aktiv (Meta-Status ${status}).`, 'Meta spielt im Moment keine Anzeigen aus.', ['Öffne den Meta Werbeanzeigenmanager und lies die Meldung von Meta oben auf der Seite.']];
      return { stufe: 'alarm', schluessel: `konto-${status}`, grund: TEXT[0], text: TEXT[1], schritte: TEXT[2], nachher: 'Sobald Meta das Konto wieder freigibt, laufen die Anzeigen weiter.' };
    }
    if (aktive > 0 && Number(k.impressionen_heute) === 0 && stundeIn(k.geprueft_am, k.zeitzone) >= 10) {
      const zp = zeitpunkt(k.geprueft_am, k.zeitzone);
      return {
        stufe: 'alarm', schluessel: 'offline', grund: 'Heute wurde noch keine einzige Anzeige ausgespielt.',
        text: zp.startsWith('heute ')
          ? `Im Konto sind ${z0(aktive)} Anzeigen aktiv, aber bis ${zp.slice(6)} hat Meta heute keine davon ausgespielt. Die Kampagnen sind also offline.`
          : `Im Konto sind ${z0(aktive)} Anzeigen aktiv, aber bei der letzten Prüfung (${zp}) hatte Meta an diesem Tag keine davon ausgespielt. Die Kampagnen waren also offline.`,
        schritte: ['Öffne den Meta Werbeanzeigenmanager und schau in der Spalte „Auslieferung“, was dort steht.', 'Prüf unter „Abrechnung und Zahlungen“, ob eine Zahlung fehlgeschlagen oder ein Limit erreicht ist.', 'Prüf, ob Anzeigen abgelehnt wurden.'],
        nachher: 'Sobald wieder ausgespielt wird, verschwindet diese Meldung nach der nächsten Prüfung.',
      };
    }
    if (status === 8 || status === 9) {
      return {
        stufe: 'warnung', schluessel: `konto-${status}`, grund: 'Eine Zahlung ist offen.',
        kurz: 'Eine Zahlung ist offen. Die Anzeigen laufen noch, aber nicht mehr lange.',
        text: status === 9
          ? 'Meta konnte eine Zahlung nicht einziehen. Die Anzeigen laufen noch während einer Kulanzfrist, danach stoppt Meta sie.'
          : 'Meta wickelt gerade eine Zahlung ab. Wenn sie nicht klappt, stoppt Meta die Anzeigen.',
        schritte: [...ZAHLUNG, 'Prüf, ob die Zahlungsmethode funktioniert, und begleiche offene Beträge.'],
      };
    }
    if (limit > 0 && ausgegeben >= limit * 0.9) {
      const rest = limit - ausgegeben;
      const D = zustand.daten;
      const letzte = D && D.verlauf ? D.verlauf.slice(-7) : [];
      const proTag = letzte.length ? letzte.reduce((s, t) => s + t.ausgaben, 0) / letzte.length : 0;
      const tage = proTag > 0 ? rest / proTag : null;
      const reicht = tage == null ? '' : tage < 1 ? ' Bei den Ausgaben der letzten Tage reicht das nicht mal mehr einen Tag.' : ` Bei den Ausgaben der letzten Tage reicht das noch etwa ${z0(Math.floor(tage))} ${Math.floor(tage) === 1 ? 'Tag' : 'Tage'}.`;
      return {
        stufe: 'warnung', schluessel: 'limit-bald', grund: 'Das Ausgabenlimit ist fast erreicht.',
        kurz: `Das Ausgabenlimit ist fast erreicht: noch ${euro(rest)} übrig.${reicht}`,
        text: `Von ${euro(limit)} sind ${euro(ausgegeben)} ausgegeben, es bleiben noch ${euro(rest)}.${reicht} Ist das Limit erreicht, stoppt Meta alle Anzeigen.`,
        balken: { ausgegeben, limit },
        schritte: [...ZAHLUNG, 'Erhöhe in den „Zahlungseinstellungen“ rechtzeitig das „Ausgabenlimit für das Konto“.'],
      };
    }
    return null;
  }

  function adsManagerLink(k) {
    const id = String(k.konto_id || '').replace(/^act_/, '');
    return id ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(id)}` : 'https://adsmanager.facebook.com/';
  }

  function zeigeAlarmFenster() {
    const b = alarm.befund;
    const k = alarm.konto;
    if (!b || !k) return;
    const fenster = $('#alarm');
    const istAlarm = b.stufe === 'alarm';
    const alt = Date.now() - new Date(k.geprueft_am).getTime() > 3 * 3600 * 1000;
    fenster.className = 'alarm-fenster ' + b.stufe;
    fenster.replaceChildren(
      h('div', { class: 'alarm-kopf' },
        h('span', { class: 'alarm-symbol', 'aria-hidden': 'true' }, '!'),
        h('div', null,
          h('p', { class: 'alarm-eyebrow' }, istAlarm ? 'Alarm' : 'Warnung'),
          h('h2', { id: 'alarm-titel', tabindex: '-1', autofocus: true }, istAlarm ? 'Deine Kampagnen sind offline' : 'Bald laufen die Kampagnen nicht mehr'))),
      h('div', { class: 'alarm-inhalt' },
        h('p', { class: 'alarm-grund' }, b.grund),
        h('p', null, b.text),
        b.balken ? h('div', { class: 'limit' },
          h('div', { class: 'limit-balken', role: 'img', 'aria-label': `${euro(b.balken.ausgegeben)} von ${euro(b.balken.limit)} ausgegeben` },
            h('span', { style: `width:${Math.min(100, (100 * b.balken.ausgegeben) / b.balken.limit).toFixed(1)}%` })),
          h('p', { class: 'limit-text' }, h('b', null, euro(b.balken.ausgegeben)), ` von ${euro(b.balken.limit)} Ausgabenlimit`)) : null,
        h('p', { class: 'alarm-zwischen' }, 'So behebst du es'),
        h('ol', { class: 'alarm-schritte' }, b.schritte.map((t) => h('li', null, t))),
        b.nachher ? h('p', null, b.nachher) : null,
        h('p', { class: 'meta' }, `Stand: ${zeitpunkt(k.geprueft_am, k.zeitzone)}. Das Werbekonto wird stündlich von 6 bis 23 Uhr geprüft.`),
        alt ? h('p', { class: 'meta' }, 'Die letzte Prüfung ist schon länger her. Vielleicht ist das Problem inzwischen behoben.') : null),
      h('div', { class: 'alarm-knoepfe' },
        h('a', { class: 'knopf ' + (istAlarm ? 'knopf-rot' : 'knopf-warn'), href: adsManagerLink(k), target: '_blank', rel: 'noopener noreferrer' }, 'Werbeanzeigenmanager öffnen ↗'),
        h('button', { class: 'knopf knopf-rand', type: 'button', onclick: () => fenster.close() }, 'Verstanden')));
    versteckeTip();
    if ($('#detail').open) $('#detail').close();
    if (!fenster.open) fenster.showModal();
    fenster.scrollTop = 0;
  }

  function zeichneAlarmLeiste() {
    const leiste = $('#alarm-leiste');
    const b = alarm.konto ? bewerteKonto(alarm.konto) : null;
    alarm.befund = b;
    document.title = b && b.stufe === 'alarm' ? `⚠ Kampagnen offline | ${SEITENTITEL}` : SEITENTITEL;
    if (!b) { leiste.hidden = true; leiste.replaceChildren(); return; }
    leiste.className = 'alarm-leiste ' + b.stufe;
    leiste.replaceChildren(h('div', { class: 'alarm-leiste-innen' },
      h('span', { class: 'puls', 'aria-hidden': 'true' }),
      h('span', null, b.stufe === 'alarm' ? h('b', null, 'Alarm: Deine Kampagnen sind offline. ') : h('b', null, 'Achtung: '), b.stufe === 'alarm' ? b.grund : b.kurz),
      h('button', { type: 'button', onclick: zeigeAlarmFenster }, b.stufe === 'alarm' ? 'Was jetzt?' : 'Details')));
    leiste.hidden = false;
  }

  async function pruefeKonto(beimOeffnen) {
    const k = await ladeKontoStatus();
    if (!k) { alarm.konto = null; zeichneAlarmLeiste(); return; }
    alarm.konto = k;
    zeichneAlarmLeiste();
    const b = alarm.befund;
    // Pop-up bei jedem Öffnen der Seite, solange ein Alarm besteht,
    // und zwischendurch, sobald ein neuer Alarm dazukommt
    if (b && b.stufe === 'alarm' && (beimOeffnen || alarm.gezeigt !== b.schluessel)) zeigeAlarmFenster();
    alarm.gezeigt = b && b.stufe === 'alarm' ? b.schluessel : null;
  }

  function starteKontoPruefung() {
    stoppeKontoPruefung();
    pruefeKonto(true);
    alarm.timer = setInterval(() => pruefeKonto(false), PRUEF_ABSTAND_MS);
  }
  function stoppeKontoPruefung() {
    if (alarm.timer) clearInterval(alarm.timer);
    alarm.timer = null;
    alarm.konto = null;
    alarm.gezeigt = null;
    zeichneAlarmLeiste();
    if ($('#alarm').open) $('#alarm').close();
  }
  $('#alarm').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // ── Anmeldung ─────────────────────────────────────────────────────────────
  function zeige(angemeldet) {
    $('#login').hidden = angemeldet;
    $('#dashboard').hidden = !angemeldet;
    if (angemeldet) { aktualisiere(); starteKontoPruefung(); } else { stoppeKontoPruefung(); $('#email').focus(); }
  }

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const fehler = $('#login-fehler');
    const knopf = $('#login-knopf');
    fehler.hidden = true;
    knopf.disabled = true;
    knopf.textContent = 'Anmelden …';
    const { error } = await db.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#passwort').value });
    knopf.disabled = false;
    knopf.textContent = 'Anmelden';
    if (error) {
      fehler.textContent = /invalid/i.test(error.message) ? 'E-Mail oder Passwort stimmt nicht.' : `Anmeldung fehlgeschlagen: ${error.message}`;
      fehler.hidden = false;
      return;
    }
    $('#passwort').value = '';
    zeige(true);
  });
  $('#abmelden').addEventListener('click', async () => {
    await db.auth.signOut();
    zustand.daten = null;
    if ($('#detail').open) $('#detail').close();
    $('#inhalt').replaceChildren();
    zeige(false);
  });

  $('#detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  db.auth.getSession().then(({ data }) => zeige(Boolean(data && data.session)));
})();
