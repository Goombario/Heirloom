// Invented, deterministic GEDCOM 5.5.1 for scale, search and data-quality testing.
// No real data: every name, place and source is made up.
//
// The default run (seed 782, target 4000) reproduces the shape of the tree used
// in docs/ux-audit/2026-09-24-task-audit.md: 4,824 people over 9 generations,
// 964 families, 417 place strings, 40 sources and 8,290 citations. Ten planted
// people (@I4825@–@I4834@) and three families follow it; the records before
// them are unchanged. It deliberately contains:
//   - Cyrillic, accented French and very long names and places;
//   - partial and approximate dates (ABT, BEF, AFT, BET … AND, EST);
//   - remarriages and 40 planted duplicate people (with a NOTE naming the
//     person each one copies);
//   - some impossible life spans (e.g. a parent who died as an infant);
//   - one planted case per unlikely data check (with a NOTE saying so), so a
//     problem can be confirmed;
//   - nicknames (NICK) and multi-citation facts.
// Russian patronymics are drawn from one mixed list, so some are the wrong
// gender. Keep that: changing the random-draw order changes every record.
// #822 enlarged the name lists (about 40 per sex and 40 surnames per culture,
// up from 8–12) so the duplicate check has a fair baseline. A pick() is one
// draw whatever the list's length, so ids, dates and families are unchanged;
// only the names differ from the audit's.
//
// Usage:
//   node scripts/ux-audit/gen-large-gedcom.mjs [--out <file>] [--people <n>] [--seed <n>]
// The default output is under the gitignored .playwright-screenshots/ folder.
// Don't commit generated files.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
  return value;
};
const out = opt('out', '.playwright-screenshots/ux-audit/large-tree.ged');
const TARGET = Number(opt('people', '4000'));
let seed = Number(opt('seed', '782'));
if (!Number.isInteger(TARGET) || TARGET < 100) throw new Error('--people must be an integer ≥ 100');
if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');

// Linear congruential generator: deterministic across Node versions and platforms.
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const cultures = {
  en: {
    m: ['Aster', 'Rowan', 'Thorne', 'Ellis', 'Corwin', 'Alder', 'Hollis', 'Merrick', 'Tobias', 'Silas', 'Edmund', 'Jasper',
      'Ambrose', 'Barnaby', 'Cedric', 'Dorian', 'Ewan', 'Fenwick', 'Gideon', 'Harlan', 'Ignatius', 'Jory', 'Kester', 'Lucan',
      'Mordecai', 'Nathaniel', 'Oswin', 'Peregrine', 'Quentin', 'Roderick', 'Septimus', 'Tristram', 'Ulric', 'Valentine',
      'Wystan', 'Absalom', 'Benedict', 'Crispin', 'Digory', 'Erasmus', 'Fabian', 'Godwin', 'Hector', 'Isidore'],
    f: ['Briar', 'Willa', 'Maren', 'Ivy', 'Linnea', 'Odette', 'Hazel', 'Clemency', 'Rosalind', 'Tamsin', 'Wren', 'Delphine',
      'Araminta', 'Beatrix', 'Cordelia', 'Dorcas', 'Eudora', 'Flora', 'Griselda', 'Honora', 'Imogen', 'Jessamy', 'Keziah',
      'Lavinia', 'Mehitabel', 'Nerissa', 'Ottilie', 'Philippa', 'Querida', 'Rowena', 'Sabina', 'Theodora', 'Ursula', 'Verity',
      'Winifred', 'Albinia', 'Bryony', 'Cressida', 'Damaris', 'Euphemia', 'Felicity', 'Gwendolen', 'Hester', 'Isolde'],
    s: ['Arbor', 'Vale', 'Fennick', 'Hallow', 'Marsh', 'Quill', 'Rookwood', 'Sallow', 'Tolland', 'Underhay',
      'Ashcombe', 'Blackthorn', 'Cobbold', 'Dunmore', 'Elderkin', 'Farrow', 'Gorsuch', 'Hartwell', 'Inchbald', 'Juniper',
      'Kettleby', 'Larkspur', 'Mossop', 'Nettlefold', 'Orrell', 'Pennyfeather', 'Quarrington', 'Ravenhill', 'Stonebridge',
      'Thistlewood', 'Upcott', 'Varley', 'Wetherby', 'Yarrow', 'Applegarth', 'Brackenbury', 'Cheswick', 'Dimmock', 'Edgecombe', 'Foxley'],
    towns: ['Lumen', 'Sunvale', 'Brackwater', 'Holloway Cross', 'Evenmere', 'Ashby-under-Wold'],
    region: ['Lumenshire', 'Westmarch'],
  },
  fr: {
    m: ['Étienne', 'Benoît', 'Honoré', 'Aurèle', 'Théophile', 'Gérard', 'Léandre', 'Anatole',
      'Amédée', 'Barthélemy', 'Césaire', 'Désiré', 'Évariste', 'Fulgence', 'Gaëtan', 'Hippolyte', 'Isidore', 'Jérôme',
      'Lazare', 'Médard', 'Narcisse', 'Octave', 'Pacôme', 'Rémi', 'Séverin', 'Thibault', 'Urbain', 'Valère', 'Zéphirin',
      'Achille', 'Baptiste', 'Cyprien', 'Dieudonné', 'Eugène', 'Firmin', 'Grégoire', 'Hilaire', 'Ignace', 'Joachim', 'Léonce'],
    f: ['Hélène', 'Adélaïde', 'Josèphe', 'Éloïse', 'Mathilde', 'Noémie', 'Célestine', 'Bérénice',
      'Agathe', 'Blandine', 'Cunégonde', 'Désirée', 'Euphrasie', 'Félicité', 'Geneviève', 'Hortense', 'Irène', 'Joséphine',
      'Léocadie', 'Madeleine', 'Nathalie', 'Odile', 'Pélagie', 'Rosalie', 'Séraphine', 'Thérèse', 'Ursule', 'Victoire',
      'Zoé', 'Apolline', 'Brigitte', 'Clémence', 'Delphine', 'Émérence', 'Flavie', 'Gertrude', 'Honorine', 'Isaure', 'Justine', 'Lucile'],
    s: ['Lefèvre', 'Duchêne', 'Bélanger', 'Côté', 'Mercier-Laroche', 'Desrosiers', 'Thériault', 'de la Fontaine-Beaumarchais',
      'Arsenault', 'Boisvert', 'Chênevert', 'Dufresne', 'Émond', 'Fréchette', 'Gagnon', 'Hébert', 'Jolicœur', 'Laflamme',
      'Marchand', 'Nadeau', 'Ouellet', 'Paradis', 'Quintal', 'Rochon', 'Sauvé', 'Turcotte', 'Vachon', 'Beauchêne',
      'Lapointe-Mérel', 'Bourassa', 'Charbonneau', 'Delorme', 'Lévesque', 'Morin', 'Pelletier', 'Rivard', 'Simard', 'Tremblay-Viau'],
    towns: ['Saint-Aurèle-des-Champs', 'Val-Brûlé', 'Beaupré-sur-Lierre', 'Notre-Dame-de-la-Merci', 'Rivière-aux-Écorces'],
    region: ['Haute-Lierre', 'Côte-Brumeuse'],
  },
  ru: {
    m: ['Алексей', 'Никифор', 'Евграф', 'Порфирий', 'Иван', 'Всеволод', 'Прохор', 'Лаврентий',
      'Агафон', 'Борис', 'Варфоломей', 'Гавриил', 'Демид', 'Ефим', 'Захар', 'Игнатий', 'Кондрат', 'Лука', 'Макар',
      'Назар', 'Онисим', 'Пантелеймон', 'Родион', 'Савва', 'Трофим', 'Устин', 'Фома', 'Харитон', 'Ювеналий', 'Яков',
      'Афанасий', 'Влас', 'Герасим', 'Дорофей', 'Елисей', 'Зосима', 'Илларион', 'Корнилий', 'Митрофан', 'Остап'],
    f: ['Евдокия', 'Аграфена', 'Пелагея', 'Ксения', 'Олимпиада', 'Василиса', 'Феврония', 'Марфа',
      'Акулина', 'Анисья', 'Варвара', 'Глафира', 'Домна', 'Ефросинья', 'Зиновия', 'Ирина', 'Капитолина', 'Лукерья',
      'Матрёна', 'Наталья', 'Ольга', 'Параскева', 'Руфина', 'Серафима', 'Таисия', 'Устинья', 'Фёкла', 'Харитина',
      'Юлиания', 'Агния', 'Белослава', 'Вера', 'Дарья', 'Евпраксия', 'Елизавета', 'Зинаида', 'Иулиания', 'Калерия', 'Любовь', 'Мавра'],
    s: ['Воронцов', 'Белозёров', 'Колокольников', 'Преображенский', 'Шуваловский', 'Тихомиров', 'Добронравов', 'Златоустовский',
      'Аксёнов', 'Бобров', 'Вешняков', 'Голубев', 'Дятлов', 'Ершов', 'Жаворонков', 'Зимин', 'Калачёв', 'Лебедев',
      'Медведев', 'Неклюдов', 'Овсянников', 'Перепёлкин', 'Рябинин', 'Снегирёв', 'Тетерин', 'Усольцев', 'Филимонов', 'Хлебников',
      'Цветков', 'Чернышёв', 'Шестаков', 'Щеглов', 'Яблоков', 'Богоявленский', 'Вознесенский', 'Рождественский', 'Троицкий', 'Успенский'],
    towns: ['Верхнезаречье', 'Кривоколенск', 'Малые Жаворонки', 'Спасо-Преображенское', 'Новотихвинск'],
    region: ['Зареченская губерния', 'Озёрский уезд'],
  },
};
// Feminine forms for Russian surnames.
const surnameFor = (c, s, sex) => (c === 'ru' && sex === 'F' ? (s.endsWith('ий') ? s.slice(0, -2) + 'ая' : s + 'а') : s);

// Places: town, parish/street subdivisions, region, country.
const countries = { en: 'Asteria', fr: 'Lierrande', ru: 'Заречье' };
const places = { en: [], fr: [], ru: [] };
// The first eight French given names, as before #822 enlarged the pool, so the place strings don't change.
const parishSaints = cultures.fr.m.slice(0, 8);
for (const [c, cul] of Object.entries(cultures)) {
  for (const t of cul.towns) {
    for (const r of cul.region) {
      places[c].push(`${t}, ${r}, ${countries[c]}`);
      for (let i = 1; i <= 12; i++) {
        let sub;
        if (c === 'ru') sub = `приход ${['Св. Николая', 'Св. Троицы', 'Покрова', 'Успения'][i % 4]} №${i}`;
        else if (c === 'fr') sub = `Paroisse Saint-${pick(parishSaints)} ${i}`;
        else sub = `${pick(['St Brigid', 'St Aelred', 'Holy Cross', 'Mill Lane', 'Harbour Street'])} ${i}`;
        places[c].push(`${sub}, ${t}, ${r}, ${countries[c]}`);
      }
    }
  }
}
const longPlace = 'Farmstead at the Old Mill beyond the Second Bridge, Lower Holloway Cross Parish, Holloway Cross, Westmarch, Asteria';
const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const date = (y) => {
  const r = rnd();
  if (r < 0.45) return `${int(1, 28)} ${pick(months)} ${y}`;
  if (r < 0.60) return `${pick(months)} ${y}`;
  if (r < 0.72) return `${y}`;
  if (r < 0.82) return `ABT ${y}`;
  if (r < 0.88) return `BEF ${y}`;
  if (r < 0.92) return `AFT ${y}`;
  if (r < 0.96) return `BET ${y - 2} AND ${y + 2}`;
  return `EST ${y}`;
};

const people = [];
const families = [];
let pid = 0;
let fid = 0;
const mkPerson = (c, sex, surname, by, gen) => {
  const cul = cultures[c];
  const given = cul[sex === 'F' ? 'f' : 'm'];
  const p = { id: `I${++pid}`, c, sex, given: pick(given), surname: surnameFor(c, surname, sex), by, gen, fams: [], famc: null };
  if (rnd() < 0.25) p.given += ' ' + pick(given);
  if (c === 'ru' && rnd() < 0.7) p.given += ' ' + pick(['Иванович', 'Никифорович', 'Алексеевна', 'Прохоровна', 'Евграфович']);
  p.bdate = date(by);
  p.bplac = pick(places[c]);
  const age = int(0, 95);
  if (by + age < 2020 && (by < 1930 || rnd() < 0.5)) {
    p.dy = by + age;
    p.ddate = date(p.dy);
    p.dplac = rnd() < 0.8 ? pick(places[c]) : null;
    if (rnd() < 0.1) p.cause = pick(['Typhus', 'Consumption', 'Old age', 'Drowned in the spring flood']);
  }
  if (rnd() < 0.3) p.occu = pick(['Miller', 'Ferryman', 'Schoolteacher', 'Clerk to the parish', 'Blacksmith', 'Laundress', 'Railway signalman']);
  if (rnd() < 0.15) p.nick = pick(['Bee', 'Old Tom', 'Коля', 'Titi', 'Duchess']);
  people.push(p);
  return p;
};

// Founders: 40 couples born 1695–1736 across cultures, then descend up to 9 generations.
let wave = [];
for (let i = 0; i < 40; i++) {
  const c = i < 20 ? 'en' : i < 30 ? 'fr' : 'ru';
  const h = mkPerson(c, 'M', pick(cultures[c].s), int(1695, 1730), 0);
  const w = mkPerson(c, 'F', pick(cultures[c].s), h.by + int(-3, 6), 0);
  wave.push([h, w]);
}
for (let gen = 1; gen <= 9 && people.length < TARGET; gen++) {
  const next = [];
  for (const [a, b] of wave) {
    const f = { id: `F${++fid}`, h: a, w: b, children: [], mdate: null, mplac: null };
    const my = Math.max(a.by, b ? b.by : a.by) + int(19, 30);
    if (b && rnd() < 0.85) {
      f.mdate = date(my);
      f.mplac = pick(places[a.c]);
    }
    families.push(f);
    a.fams.push(f);
    if (b) b.fams.push(f);
    const n = people.length > TARGET ? 0 : int(1, gen < 4 ? 6 : 4);
    for (let k = 0; k < n; k++) {
      const c = rnd() < 0.05 ? pick(['en', 'fr', 'ru']) : a.c;
      const childSurname = a.surname.replace(/(ая|а)$/, (m) => (m === 'ая' ? 'ий' : ''));
      const ch = mkPerson(c, rnd() < 0.5 ? 'M' : 'F', childSurname, my + 1 + k * int(1, 3), gen);
      ch.famc = f;
      f.children.push(ch);
      if (ch.by < 1990) next.push(ch);
    }
    // Remarriage for ~12% of widowed men.
    if (b && b.dy && rnd() < 0.12 && a.fams.length === 1) {
      next.push([a, mkPerson(a.c, 'F', pick(cultures[a.c].s), a.by + int(3, 15), gen - 1)]);
    }
  }
  wave = [];
  for (const x of next) {
    if (Array.isArray(x)) {
      wave.push(x);
      continue;
    }
    if (rnd() < 0.7) {
      wave.push(x.sex === 'M'
        ? [x, mkPerson(x.c, 'F', pick(cultures[x.c].s), x.by + int(-4, 5), gen)]
        : [mkPerson(x.c, 'M', pick(cultures[x.c].s), x.by + int(-3, 7), gen), x]);
    }
  }
}
// Very long names and places on a handful of people.
people[5].given = 'Clemency Rosalind Tamsin Wilhelmina Adelaide';
people[5].surname = 'Fennick-Rookwood-Underhay';
people[9].bplac = longPlace;
people[12].surname = 'de la Fontaine-Beaumarchais du Val-Brûlé';

// Duplicates: 40 people entered twice with a slightly different spelling or date, no family links.
const dupes = [];
for (let i = 0; i < 40; i++) {
  const o = people[int(50, people.length - 1)];
  const d = { ...o, id: `I${++pid}`, fams: [], famc: null, dup: o.id };
  if (rnd() < 0.5) d.given = d.given.replace(/e/, 'a');
  d.bdate = rnd() < 0.5 ? `ABT ${o.by}` : `${o.by + 1}`;
  dupes.push(d);
}
people.push(...dupes);

// Planted unlikely data-check problems, one per rule. The random tree only has
// impossible ones, and only an unlikely problem can be confirmed (#786), so
// these cover the Confirm flow and its audit entry. Fixed values, no rnd() and
// no citations: every record above stays byte-identical for a given seed.
const plantPlace = places.en[0];
const plant = (given, surname, sex, bdate, extra = {}) => {
  const p = { id: `I${++pid}`, c: 'en', sex, given, surname, bdate, bplac: plantPlace, fams: [], famc: null, planted: true, ...extra };
  people.push(p);
  return p;
};
const plantFamily = (h, w, mdate, children) => {
  const f = { id: `F${++fid}`, h, w, children, mdate, mplac: mdate ? plantPlace : null, planted: true };
  families.push(f);
  h.fams.push(f);
  w.fams.push(f);
  for (const ch of children) ch.famc = f;
};
const planted = people.length;
plant('Tobias', 'Sallow', 'M', '14 FEB 1702', { dy: 1818, ddate: '3 NOV 1818', note: 'Planted data check: over 110 at death.' });
plant('Hazel', 'Quill', 'F', '9 MAY 1893', { living: true, note: 'Planted data check: marked living, and over 110 today.' });
// A mother aged 58 at her child's birth.
plantFamily(
  plant('Edmund', 'Tolland', 'M', '2 JAN 1745', { dy: 1812, ddate: '1812' }),
  plant('Maren', 'Hallow', 'F', '20 JUN 1748', { dy: 1820, ddate: '1820', note: 'Planted data check: a mother over 55 at a child’s birth.' }),
  '1770',
  [plant('Wren', 'Tolland', 'F', '11 AUG 1806', { dy: 1880, ddate: '1880' })],
);
// A father aged 11 at his child's birth. No marriage date, so it isn't also "married too young".
plantFamily(
  plant('Jasper', 'Marsh', 'M', '12 MAR 1790', { dy: 1860, ddate: '1860', note: 'Planted data check: a parent under 12 at a child’s birth.' }),
  plant('Linnea', 'Vale', 'F', '1785', { dy: 1850, ddate: '1850' }),
  null,
  [plant('Silas', 'Marsh', 'M', '5 JUN 1801', { dy: 1870, ddate: '1870' })],
);
// A wife aged 11 when the marriage starts.
plantFamily(
  plant('Corwin', 'Arbor', 'M', '1815', { dy: 1880, ddate: '1880' }),
  plant('Ivy', 'Fennick', 'F', '3 APR 1820', { dy: 1890, ddate: '1890', note: 'Planted data check: under 12 when a partnership starts.' }),
  '9 SEP 1831',
  [],
);
const plantedCount = people.length - planted;

// Sources: 40, with the first five cited far more often than the rest.
const sources = [];
for (let i = 1; i <= 40; i++) {
  const c = i <= 20 ? 'en' : i <= 30 ? 'fr' : 'ru';
  const kind = pick(['Census', 'Parish register', 'Civil registration', 'Newspaper', 'Will']);
  let title;
  if (c === 'ru') title = `Метрическая книга, ${pick(cultures.ru.towns)}, ${1780 + i * 4}–${1790 + i * 4}`;
  else if (c === 'fr') title = `Registre paroissial, ${pick(cultures.fr.towns)}, ${1750 + i * 5}`;
  else title = `${kind}, ${pick(cultures.en.towns)}, ${1780 + i * 5}`;
  sources.push({ id: `S${i}`, title, auth: c === 'en' ? `${pick(cultures.en.towns)} Record Office` : null });
}
const cite = (lines, lvl) => {
  if (rnd() >= 0.35) return;
  const n = rnd() < 0.15 ? 3 : 1;
  for (let k = 0; k < n; k++) {
    const s = rnd() < 0.5 ? sources[int(0, 4)] : pick(sources);
    lines.push(`${lvl} SOUR @${s.id}@`, `${lvl + 1} PAGE folio ${int(1, 400)}, entry ${int(1, 60)}`, `${lvl + 1} QUAY ${int(0, 3)}`);
  }
};

const L = ['0 HEAD', '1 SOUR TASKAUDIT', '2 NAME Task audit generator', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8', '1 SUBM @U1@', '0 @U1@ SUBM', '1 NAME Task audit'];
for (const p of people) {
  // Planted records take no random citations or residences (see above).
  const src = p.planted ? () => {} : cite;
  L.push(`0 @${p.id}@ INDI`, `1 NAME ${p.given} /${p.surname}/`);
  src(L, 2);
  if (p.nick) L.push(`2 NICK ${p.nick}`);
  L.push(`1 SEX ${p.sex}`);
  L.push('1 BIRT', `2 DATE ${p.bdate}`, `2 PLAC ${p.bplac}`);
  src(L, 2);
  if (p.dy) {
    L.push('1 DEAT', `2 DATE ${p.ddate}`);
    if (p.dplac) L.push(`2 PLAC ${p.dplac}`);
    if (p.cause) L.push(`2 CAUS ${p.cause}`);
    src(L, 2);
  }
  if (p.occu) {
    L.push(`1 OCCU ${p.occu}`);
    src(L, 2);
  }
  if (!p.planted && rnd() < 0.2) {
    L.push('1 RESI', `2 DATE ${date(p.by + int(10, 40))}`, `2 PLAC ${pick(places[p.c])}`);
    src(L, 2);
  }
  if (p.living) L.push('1 _LIVING');
  if (p.note) L.push(`1 NOTE ${p.note}`);
  if (p.dup) L.push(`1 NOTE Possibly the same person as @${p.dup}@; copied from a cousin's tree.`);
  if (p.famc) L.push(`1 FAMC @${p.famc.id}@`);
  for (const f of p.fams) L.push(`1 FAMS @${f.id}@`);
}
for (const f of families) {
  L.push(`0 @${f.id}@ FAM`, `1 HUSB @${f.h.id}@`);
  if (f.w) L.push(`1 WIFE @${f.w.id}@`);
  if (f.mdate) {
    L.push('1 MARR', `2 DATE ${f.mdate}`, `2 PLAC ${f.mplac}`);
    if (!f.planted) cite(L, 2);
  }
  for (const c of f.children) L.push(`1 CHIL @${c.id}@`);
}
for (const s of sources) {
  L.push(`0 @${s.id}@ SOUR`, `1 TITL ${s.title}`);
  if (s.auth) L.push(`1 AUTH ${s.auth}`);
}
L.push('0 TRLR');

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, L.join('\n') + '\n');
const placeSet = new Set(people.flatMap((p) => [p.bplac, p.dplac]).concat(families.map((f) => f.mplac)).filter(Boolean));
const citations = L.filter((l) => /^\d SOUR @S/.test(l)).length;
console.log(JSON.stringify({ out, people: people.length, families: families.length, places: placeSet.size, sources: sources.length, citations, duplicates: dupes.length, planted: plantedCount, bytes: fs.statSync(out).size }));
