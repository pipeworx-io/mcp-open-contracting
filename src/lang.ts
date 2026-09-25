/**
 * Native-language query expansion for the OCDS mirror.
 *
 * The tool description is written in English and `country` enumerates
 * countries in English, so callers ask English questions of text that 19
 * publishers store in Spanish, Albanian, Croatian, Italian and Thai. An
 * English substring appears nowhere in a Spanish title, so the caller got a
 * silent zero — "Ministry of Health" + Dominican Republic returned 0 of
 * 40,740 processes while "Ministerio de Salud" returned rows.
 *
 * What this is NOT: a translator. Bilingual procurement corpora are *mixed*,
 * not consistently one language, so rewriting the query one-way would drop
 * whatever is filed in the other language. Instead every spelling — the one
 * the caller typed and every native equivalent — goes into ONE PostgREST
 * `or=(...)`, which is a single SQL predicate: the branches union, a row
 * matching several is still returned once, and there is no second round trip.
 *
 * The lookup is deliberately bidirectional. A caller who types "Ministerio de
 * Educacion" without the accent needs the stored "EDUCACIÓN", and the same
 * table that maps english→native maps that unaccented Spanish token back to
 * the accented stored form. That covers the diacritic problem exactly, with
 * fully literal patterns a trigram index can still use.
 */

/** Language each publisher files its tender text in. `country` is already an
 *  indexed eq-filter, so it tells us which language to expand into. */
export const PUBLISHER_LANGUAGE: Record<string, string> = {
  Albania: 'sq',
  Kosovo: 'sq',
  Croatia: 'hr',
  Italy: 'it',
  Thailand: 'th',
  'Dominican Republic': 'es',
  Peru: 'es',
  Uruguay: 'es',
  Honduras: 'es',
  Guatemala: 'es',
  Mexico: 'es',
  Argentina: 'es',
  Kenya: 'en',
  Nigeria: 'en',
  Ghana: 'en',
  Zambia: 'en',
  Liberia: 'en',
  Rwanda: 'en',
  Tanzania: 'en',
};

export const LANGUAGE_NAME: Record<string, string> = {
  es: 'Spanish',
  sq: 'Albanian',
  hr: 'Croatian',
  it: 'Italian',
  th: 'Thai',
  en: 'English',
};

/** Publishers grouped by language, for the "why did this miss" hint. */
export const LANGUAGE_PUBLISHERS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [country, lang] of Object.entries(PUBLISHER_LANGUAGE)) {
    (out[lang] ??= []).push(country);
  }
  return out;
})();

interface Term {
  en: string[];
  es?: string[];
  sq?: string[];
  hr?: string[];
  it?: string[];
  th?: string[];
}

/**
 * The buyer and subject words that actually appear in these corpora, sampled
 * from live rows per publisher (Peru's "MUNICIPALIDAD DISTRITAL DE …",
 * Italy's "COMUNE DI …", Croatia's "MINISTARSTVO …", Albania's "Blerje …",
 * Bangkok's "สำนักงานเขต…"). Native variants carry the accents the data is
 * stored with AND the bare-ASCII spelling a caller is likely to type.
 */
const TERMS: Term[] = [
  { en: ['ministry', 'ministries'], es: ['ministerio', 'secretaría', 'secretaria'], sq: ['ministria', 'ministrisë', 'ministrise'], hr: ['ministarstvo', 'ministarstva'], it: ['ministero'], th: ['กระทรวง'] },
  { en: ['municipality', 'municipal', 'commune', 'council'], es: ['municipalidad', 'municipio', 'intendencia'], sq: ['bashkia', 'bashkisë', 'bashkise', 'komuna'], hr: ['općina', 'opcina', 'grad'], it: ['comune', 'comuni'], th: ['เทศบาล', 'สำนักงานเขต'] },
  { en: ['city', 'town'], es: ['ciudad'], sq: ['qyteti'], hr: ['grad'], it: ['città', 'citta'], th: ['เมือง'] },
  { en: ['government', 'governmental'], es: ['gobierno', 'gubernamental'], sq: ['qeveria', 'qeverisë'], hr: ['vlada', 'vlade'], it: ['governo'], th: ['รัฐบาล'] },
  { en: ['health', 'healthcare', 'sanitary'], es: ['salud', 'sanidad', 'sanitaria'], sq: ['shëndetësisë', 'shendetesise', 'shëndet'], hr: ['zdravstva', 'zdravlje'], it: ['salute', 'sanità', 'sanita'], th: ['สุขภาพ', 'สาธารณสุข'] },
  { en: ['hospital', 'hospitals', 'clinic'], es: ['hospital', 'hospitalario', 'clínica'], sq: ['spitali', 'spitalit'], hr: ['bolnica', 'bolnice'], it: ['ospedale', 'ospedaliera'], th: ['โรงพยาบาล'] },
  { en: ['university', 'universities'], es: ['universidad'], sq: ['universiteti', 'universitetit'], hr: ['sveučilište', 'sveuciliste'], it: ['università', 'universita'], th: ['มหาวิทยาลัย'] },
  { en: ['school', 'schools'], es: ['escuela', 'colegio'], sq: ['shkolla', 'shkollës'], hr: ['škola', 'skola'], it: ['scuola', 'scuole'], th: ['โรงเรียน'] },
  { en: ['education', 'educational'], es: ['educación', 'educacion', 'educativa'], sq: ['arsimit', 'arsim'], hr: ['obrazovanja', 'obrazovanje'], it: ['istruzione'], th: ['การศึกษา'] },
  { en: ['agency'], es: ['agencia'], sq: ['agjencia', 'agjencisë'], hr: ['agencija', 'agencije'], it: ['agenzia'], th: ['สำนักงาน'] },
  { en: ['authority', 'authorities'], es: ['autoridad', 'organismo'], sq: ['autoriteti', 'autoritetit'], hr: ['uprava', 'agencija'], it: ['autorità', 'autorita'], th: ['สำนักงาน'] },
  { en: ['department', 'directorate', 'division'], es: ['dirección', 'direccion', 'departamento'], sq: ['drejtoria', 'drejtorisë'], hr: ['uprava', 'odjel'], it: ['direzione', 'dipartimento'], th: ['กรม', 'สำนัก'] },
  { en: ['institute', 'institution'], es: ['instituto', 'institución', 'institucion'], sq: ['instituti', 'institucioni'], hr: ['institut', 'ustanova'], it: ['istituto'], th: ['สถาบัน'] },
  { en: ['national'], es: ['nacional'], sq: ['kombëtar', 'kombetar'], hr: ['nacionalni', 'državni'], it: ['nazionale'], th: ['แห่งชาติ'] },
  { en: ['police'], es: ['policía', 'policia'], sq: ['policia', 'policisë'], hr: ['policija', 'policije'], it: ['polizia'], th: ['ตำรวจ'] },
  { en: ['defence', 'defense', 'military', 'army'], es: ['defensa', 'ejército', 'ejercito'], sq: ['mbrojtjes', 'mbrojtje'], hr: ['obrane', 'obrana'], it: ['difesa'], th: ['กลาโหม', 'ทหาร'] },
  { en: ['court', 'justice', 'judicial'], es: ['corte', 'justicia', 'judicial'], sq: ['gjykata', 'drejtësi'], hr: ['sud', 'pravosuđa'], it: ['tribunale', 'giustizia'], th: ['ศาล', 'ยุติธรรม'] },
  { en: ['finance', 'financial', 'treasury'], es: ['finanzas', 'hacienda', 'financiera'], sq: ['financave', 'financa'], hr: ['financija', 'financije'], it: ['finanze', 'finanziaria'], th: ['การคลัง'] },
  { en: ['interior', 'home'], es: ['interior'], sq: ['brendshme'], hr: ['unutarnjih'], it: ['interno'], th: ['มหาดไทย'] },
  { en: ['social', 'welfare'], es: ['social', 'bienestar'], sq: ['sociale', 'social'], hr: ['socijalne', 'socijalna'], it: ['sociale'], th: ['สังคม'] },
  { en: ['agriculture', 'agricultural', 'farming'], es: ['agricultura', 'agropecuaria', 'agrícola', 'agricola'], sq: ['bujqësisë', 'bujqesise'], hr: ['poljoprivrede'], it: ['agricoltura'], th: ['เกษตร'] },
  { en: ['food', 'foodstuffs'], es: ['alimentos', 'alimentación', 'alimentacion'], sq: ['ushqim', 'ushqimore'], hr: ['hrana', 'hrane'], it: ['alimenti', 'alimentari'], th: ['อาหาร'] },
  { en: ['water', 'sanitation', 'sewer'], es: ['agua', 'saneamiento', 'potable'], sq: ['ujë', 'uje', 'ujësjellës'], hr: ['voda', 'vodovod', 'vodoopskrba'], it: ['acqua', 'acquedotto'], th: ['น้ำ', 'ประปา'] },
  { en: ['road', 'roads', 'highway', 'street'], es: ['carretera', 'carreteras', 'vial'], sq: ['rrugë', 'rruge', 'rrugore'], hr: ['cesta', 'ceste', 'autoceste'], it: ['strada', 'strade', 'autostrade'], th: ['ถนน'] },
  { en: ['transport', 'transportation', 'mobility'], es: ['transporte', 'movilidad'], sq: ['transportit', 'transport'], hr: ['prometa', 'promet'], it: ['trasporti', 'mobilità'], th: ['คมนาคม', 'ขนส่ง'] },
  { en: ['energy', 'electricity', 'power', 'electrical'], es: ['energía', 'energia', 'electricidad', 'eléctrica'], sq: ['energjisë', 'energji'], hr: ['energija', 'električne'], it: ['energia', 'elettrica'], th: ['พลังงาน', 'ไฟฟ้า'] },
  { en: ['construction', 'works', 'building', 'civil'], es: ['construcción', 'construccion', 'obras'], sq: ['ndërtim', 'ndertim', 'punë'], hr: ['gradnja', 'radovi', 'izgradnja'], it: ['costruzione', 'lavori'], th: ['ก่อสร้าง'] },
  { en: ['maintenance', 'repair'], es: ['mantenimiento', 'reparación', 'reparacion'], sq: ['mirëmbajtje', 'mirembajtje'], hr: ['održavanje', 'odrzavanje'], it: ['manutenzione'], th: ['บำรุงรักษา', 'ซ่อม'] },
  { en: ['procurement', 'purchase', 'supply', 'supplies', 'acquisition'], es: ['adquisición', 'adquisicion', 'compra', 'suministro'], sq: ['furnizim', 'blerje'], hr: ['nabava', 'nabave'], it: ['fornitura', 'acquisto'], th: ['จัดซื้อ', 'จัดจ้าง'] },
  { en: ['services', 'service'], es: ['servicios', 'servicio'], sq: ['shërbime', 'sherbime'], hr: ['usluge', 'usluga'], it: ['servizi', 'servizio'], th: ['บริการ'] },
  { en: ['equipment', 'machinery'], es: ['equipos', 'equipamiento', 'maquinaria'], sq: ['pajisje', 'makineri'], hr: ['oprema', 'opreme'], it: ['attrezzature', 'macchinari'], th: ['อุปกรณ์', 'ครุภัณฑ์'] },
  { en: ['medical', 'medicine', 'medicines', 'drugs', 'pharmaceutical'], es: ['médico', 'medico', 'medicamentos', 'insumos'], sq: ['mjekësor', 'mjekesor', 'barna'], hr: ['medicinski', 'lijekovi'], it: ['medico', 'farmaci'], th: ['การแพทย์', 'ยา'] },
  { en: ['vehicle', 'vehicles', 'fleet'], es: ['vehículo', 'vehiculo', 'vehicular', 'flotilla'], sq: ['automjete', 'automjeteve'], hr: ['vozila'], it: ['veicoli', 'autoveicoli'], th: ['ยานพาหนะ', 'รถ'] },
  { en: ['fuel', 'petrol', 'diesel'], es: ['combustible', 'gasolina', 'gasoil'], sq: ['karburant', 'naftë'], hr: ['gorivo', 'goriva'], it: ['carburante', 'gasolio'], th: ['เชื้อเพลิง', 'น้ำมัน'] },
  { en: ['security', 'safety'], es: ['seguridad'], sq: ['sigurisë', 'siguri'], hr: ['sigurnosti', 'sigurnost'], it: ['sicurezza'], th: ['ความปลอดภัย', 'รักษาความปลอดภัย'] },
  { en: ['cleaning', 'hygiene'], es: ['limpieza', 'higiene'], sq: ['pastrim', 'higjienike'], hr: ['čišćenje', 'ciscenje'], it: ['pulizia', 'igiene'], th: ['ทำความสะอาด'] },
  { en: ['software', 'computer', 'informatics', 'technology'], es: ['informática', 'informatica', 'tecnología', 'tecnologia'], sq: ['informatike', 'teknologji'], hr: ['informatičke', 'informaticke'], it: ['informatica', 'tecnologia'], th: ['คอมพิวเตอร์', 'เทคโนโลยี'] },
  { en: ['insurance'], es: ['seguro', 'seguros'], sq: ['sigurimi'], hr: ['osiguranje'], it: ['assicurazione'], th: ['ประกันภัย'] },
  { en: ['tourism'], es: ['turismo', 'turística', 'turistica'], sq: ['turizmit', 'turizëm'], hr: ['turizma'], it: ['turismo'], th: ['ท่องเที่ยว'] },
  { en: ['environment', 'environmental'], es: ['ambiente', 'ambiental'], sq: ['mjedisit', 'mjedis'], hr: ['okoliša', 'okolisa'], it: ['ambiente', 'ambientale'], th: ['สิ่งแวดล้อม'] },
  { en: ['culture', 'sport', 'sports'], es: ['cultura', 'deportes'], sq: ['kulturës', 'sportit'], hr: ['kulture', 'sporta'], it: ['cultura', 'sport'], th: ['วัฒนธรรม', 'กีฬา'] },
  { en: ['labour', 'labor', 'employment', 'work'], es: ['trabajo', 'empleo', 'laboral'], sq: ['punës', 'punes', 'punësimit'], hr: ['rada', 'zapošljavanja'], it: ['lavoro'], th: ['แรงงาน'] },
  { en: ['port', 'airport', 'aviation'], es: ['puerto', 'aeropuerto', 'aérea'], sq: ['porti', 'aeroporti'], hr: ['luka', 'zračna'], it: ['porto', 'aeroporto'], th: ['ท่าเรือ', 'สนามบิน'] },
  { en: ['railway', 'rail', 'train'], es: ['ferrocarril', 'ferroviaria'], sq: ['hekurudha'], hr: ['željeznica', 'zeljeznica'], it: ['ferroviaria', 'ferrovie'], th: ['รถไฟ'] },
  { en: ['waste', 'garbage', 'refuse'], es: ['residuos', 'basura', 'desechos'], sq: ['mbeturina', 'mbetjeve'], hr: ['otpad', 'otpada'], it: ['rifiuti'], th: ['ขยะ'] },
];

/** token (in any covered language) → its term. First entry wins on collision. */
const TERM_INDEX = new Map<string, Term>();
for (const term of TERMS) {
  for (const list of Object.values(term) as string[][]) {
    for (const word of list) {
      const key = word.toLowerCase();
      if (!TERM_INDEX.has(key)) TERM_INDEX.set(key, term);
    }
  }
}

/** Connectors in every covered language — they carry no matching signal and
 *  differ between the caller's phrasing and the stored one ("of" vs "de"). */
const STOPWORDS = new Set([
  'of', 'the', 'for', 'and', 'a', 'an', 'to', 'in', 'on', 'at', 'by', 'with',
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'en', 'para', 'por', 'con',
  'di', 'della', 'delle', 'dei', 'degli', 'il', 'lo', 'le', 'per', 'e', 'i', 'da',
  'të', 'te', 'së', 'se', 'dhe', 'për', 'per', 'në', 'ne', 'me',
  'za', 'u', 'na', 'iz', 'o',
]);

/**
 * Strip the characters that are structural inside a PostgREST `or=(...)` list
 * or inside an ilike pattern, so caller text can never break the query it
 * lands in. `*` goes too: it is our own word separator below.
 */
export function safePattern(v: string): string {
  return v.replace(/[,()"*\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Cross-product of per-token variants, joined by `*` (ilike's wildcard), so
 *  "Ministerio" + "Salud" matches "MINISTERIO DE SALUD PÚBLICA". Bounded. */
function crossJoin(lists: string[][], cap: number): string[] {
  let out: string[] = [''];
  for (const list of lists) {
    const next: string[] = [];
    for (const prefix of out) {
      for (const v of list) {
        if (next.length >= cap) break;
        next.push(prefix ? `${prefix}*${v}` : v);
      }
    }
    out = next;
  }
  return out.filter(Boolean);
}

// Every spelling becomes 3 or-branches (title, buyer, description), so these
// caps are what keeps one query from turning into a hundred ilike predicates
// over a 838k-row table. The first variant listed for each term is the one the
// corpora actually use most, so truncation drops the rarest spelling, not the
// common one.
const MAX_VARIANTS_PER_TOKEN = 3;
const MAX_PATTERNS_PER_LANGUAGE = 8;
const MAX_PATTERNS_TOTAL = 24;

function translate(tokens: string[], lang: string): string[] {
  // An English publisher needs no vocabulary substitution — the caller is
  // already speaking the corpus's language. What it does still need is
  // tolerance for the connector: the literal "%Ministry of Health%" misses a
  // caller who typed "health ministry" or "Ministry Health", so join the
  // content words with the wildcard and, for two words, try both orders.
  if (lang === 'en') {
    if (tokens.length < 2) return [];
    const forward = tokens.join('*');
    return tokens.length === 2 ? [forward, `${tokens[1]}*${tokens[0]}`] : [forward];
  }

  const lists: string[][] = [];
  let translated = false;
  for (const token of tokens) {
    const term = TERM_INDEX.get(token.toLowerCase());
    const variants = term ? (term as unknown as Record<string, string[] | undefined>)[lang] : undefined;
    if (variants?.length) {
      translated = true;
      lists.push(variants.slice(0, MAX_VARIANTS_PER_TOKEN));
    } else {
      lists.push([token]);
    }
  }
  // Nothing in the phrase is a word we know in this language — the literal is
  // as good as we can do, and inventing patterns would only add false hits.
  if (!translated) return [];
  const out = crossJoin(lists, MAX_PATTERNS_PER_LANGUAGE);
  // Word order flips between languages ("road construction" is filed as
  // "construcción de carreteras"), so a two-word phrase gets both orders.
  // Beyond two words the permutations stop being worth the branches.
  if (lists.length === 2) out.push(...crossJoin([lists[1], lists[0]], MAX_PATTERNS_PER_LANGUAGE));
  return out;
}

export interface QueryExpansion {
  /** Every spelling searched, literal first. Echoed to the caller. */
  spellings: string[];
  /** Language of the publisher filtered to, or null when searching all. */
  language: string | null;
  /** null when the caller passed no country. */
  country: string | null;
  note?: string;
}

/**
 * Expand a caller's free-text query into every spelling worth searching for.
 * With a country, that is the caller's literal plus its equivalents in that
 * publisher's language; without one, the literal plus equivalents in every
 * non-English publisher language this pack covers, bounded.
 */
export function expandQuery(rawQuery: string, country: string | null): QueryExpansion {
  const literal = safePattern(rawQuery);
  const spellings = [literal];
  const tokens = literal.split(' ').filter((t) => t && !STOPWORDS.has(t.toLowerCase()));

  const lang = country ? PUBLISHER_LANGUAGE[country] ?? null : null;
  // Spanish first when searching everything: it is 7 of the 19 publishers and
  // the two largest corpora, so it must not be the language the cap starves.
  const targets = lang ? [lang] : ['es', 'sq', 'hr', 'it', 'th', 'en'];
  const perLanguage = Math.max(1, Math.floor(MAX_PATTERNS_TOTAL / targets.length));

  const seen = new Set([literal.toLowerCase()]);
  for (const target of targets) {
    let taken = 0;
    for (const pattern of translate(tokens, target)) {
      if (spellings.length >= MAX_PATTERNS_TOTAL || taken >= perLanguage) break;
      const key = pattern.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      spellings.push(pattern);
      taken += 1;
    }
  }

  const languageName = lang ? LANGUAGE_NAME[lang] : null;
  let note: string | undefined;
  if (spellings.length > 1) {
    note = languageName
      ? `Searched the phrase you passed plus its ${languageName} equivalents, because this publisher files tender text in ${languageName}. "*" is a wildcard between words.`
      : 'Searched the phrase you passed plus its equivalents in every non-English publisher language covered (Spanish, Albanian, Croatian, Italian, Thai). Pass country= to target one publisher.';
  } else if (languageName && languageName !== 'English') {
    note = `This publisher files tender text in ${languageName} and none of your words are in the ${languageName} vocabulary this tool knows, so only the literal phrase was searched.`;
  }

  return { spellings, language: languageName, country, note };
}

/** The "why did this miss" hint — names the language, never a bare zero. */
export function emptyResultHint(expansion: QueryExpansion): string {
  const { language, country, spellings } = expansion;
  const tried = `Searched ${spellings.length} spelling${spellings.length === 1 ? '' : 's'}: ${spellings.map((s) => `"${s}"`).join(', ')}.`;
  if (country && language && language !== 'English') {
    return `No match — and the language is the likely reason. ${country} publishes tender titles, buyers and descriptions in ${language}, not English. ${tried} Try a ${language} phrase, or drop query and filter by country + category to see what this publisher actually has.`;
  }
  if (country) {
    return `No match. ${country} publishes in ${language ?? 'its own language'}. ${tried} Try a shorter or more general phrase, or drop query and filter by country + category.`;
  }
  const groups = Object.entries(LANGUAGE_PUBLISHERS)
    .map(([code, countries]) => `${LANGUAGE_NAME[code]} (${countries.join(', ')})`)
    .join('; ');
  return `No match across all publishers. Tender text is stored in each publisher's own language — ${groups} — so an English phrase misses the non-English ones. ${tried} Pass country= so the search can expand your words into that publisher's language.`;
}
