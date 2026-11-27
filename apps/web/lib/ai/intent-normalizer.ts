export interface SpeechCorrectionNote {
  from: string;
  to: string;
  reason: string;
}

export interface NormalizedUtterance {
  raw: string;
  cleaned: string;
  normalizedEnglish: string;
  corrections: SpeechCorrectionNote[];
  extractedTimesSec: string[];
  extractedSizeMb?: number;
  extractedFormat?: string;
  extractedAspect?: '9:16' | '16:9' | '1:1' | '4:5';
  ordinalRef?: 'first' | 'second' | 'third' | 'last' | 'all' | 'previous_output';
  isFollowUpTweak: boolean;
  isAffirmation: boolean;
  isNegation: boolean;
  hinglishDetected: boolean;
}

const SPOKEN_NUMBER_MAP: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  fifteen: '15',
  sixteen: '16',
  twenty: '20',
  'twenty five': '25',
  'twenty-five': '25',
  thirty: '30',
  'forty five': '45',
  'forty-five': '45',
  fifty: '50',
  sixty: '60',
  ninety: '90',
  hundred: '100',
};

const HINGLISH_PHRASE_MAP: Array<[RegExp, string]> = [
  [/\b(chhota|chota|kam|shrink|size\s*kam)\s*(karo|krdo|kar\s*do|kardo|karna)?\b/gi, ' compress '],
  [/\b(audio|awaaz|awaz|sound|gaana)\s*(nikal|nikalo|alag|extract)\s*(do|karo|krdo|kardo)?\b/gi, ' extract audio mp3 '],
  [/\b(personal\s*info|private\s*details?|aadhaar|pan\s*card|phone\s*number)\s*(chhipa|chhupa|hata|mita|black\s*out|hide)\s*(do|karo|krdo)?\b/gi, ' hide personal info redact '],
  [/\b(hide|black\s*out|mask|remove)\s+(?:my\s+)?(?:personal\s+details?|phone(?:\s*numbers?)?|aadhaar|pan|cards?|emails?|ssn)\b/gi, ' hide personal info redact '],
  [/\b(samjhao|samjha\s*do|short\s*mein?\s*batao|saaransh|summary\s*do)\b/gi, ' summarize '],
  [/\b(jodo|mila\s*do|ek\s*saath\s*karo|combine\s*karo)\b/gi, ' merge '],
  [/\b(kaat\s*do|cut\s*karo|trim\s*karo|chhota\s*clip)\b/gi, ' trim '],
  [/\b(lock\s*karo|password\s*laga\s*do|band\s*karo)\b/gi, ' lock protect password '],
  [/\b(unlock\s*karo|password\s*hatao|kholo)\b/gi, ' unlock '],
  [/\b(table|excel|sheet)\s*(nikal|banao|extract)\b/gi, ' extract tables csv '],
  [/\b(sunao|padh\s*ke\s*sunao|bol\s*ke\s*batao)\b/gi, ' audio summary read aloud '],
  [/\b(reels?|shorts?)\s*(banao|mein\s*badlo|ke\s*liye)\b/gi, ' reframe 9:16 vertical reels '],
  [/\b(whatsapp)\s*(ke\s*liye|pe\s*bhejna|send\s*karna)\b/gi, ' compress whatsapp 16 mb '],
  [/\b(discord)\s*(ke\s*liye|pe\s*bhejna)\b/gi, ' compress discord 10 mb '],
  [/\b(pdf)\s*(banao|banado|bana\s*do|create)\b/gi, ' create pdf '],
];

function replaceSpokenNumbers(input: string): string {
  let out = input;
  const entries = Object.entries(SPOKEN_NUMBER_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [word, digit] of entries) {
    const re = new RegExp(`\\b${word}\\b(?=\\s*(?:mb|megabytes?|sec|seconds?|min|minutes?|degrees?|deg|percent|%))`, 'gi');
    out = out.replace(re, digit);
  }
  return out;
}

function secondsToClock(secTotal: number): string {
  const safe = Math.max(0, Math.round(secTotal));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function normalizeUserUtterance(rawInput: string): NormalizedUtterance {
  const raw = rawInput.trim();
  const corrections: SpeechCorrectionNote[] = [];

  // 1. Preserve URLs untouched so stream probing never corrupts query params
  if (/^https?:\/\/\S+$/i.test(raw)) {
    return {
      raw,
      cleaned: raw,
      normalizedEnglish: raw,
      corrections: [],
      extractedTimesSec: [],
      isFollowUpTweak: false,
      isAffirmation: false,
      isNegation: false,
      hinglishDetected: false,
    };
  }

  // 2. Clean wake words & voice hesitation fillers
  let cleaned = raw
    .replace(/^(?:hey|ok|okay|hi)\s+muxaro[,.\s]*/i, '')
    .replace(/\b(?:um+|uh+|er+|ah+)\b[,.\s]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = replaceSpokenNumbers(cleaned);

  // 3. Detect explicit dictation self-corrections & reversals ("X no wait make it Y", "scratch that Y")
  // Full reset reversal: "trim it ... actually forget that, extract audio"
  const hardReset = cleaned.match(/^(.+?)\s*(?:,\s*)?\b(?:scratch that|forget that|never\s*mind|cancel that|nahi\s*ruko)\b[,.\s]+(.+)$/i);
  if (hardReset) {
    corrections.push({
      from: hardReset[1].trim(),
      to: hardReset[2].trim(),
      reason: 'Applied latest spoken correction',
    });
    cleaned = hardReset[2].trim();
  }

  // Inline parameter reversal: "make it 16 mb no wait 10 mb" or "trim to 0:40 actually make that 0:55"
  const valueReversal = cleaned.match(
    /(\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?\s*(?:mb|s|sec|degrees?)|mkv|mov|webm|mp4|mp3|flac|wav|16:9|9:16|1:1)\s*(?:,?\s*\b(?:no\s*wait|wait\s*no|sorry|actually|i\s*mean|make\s*(?:it|that)|change\s*(?:it\s*)?to|not\s+that)\b\s*)+(\d{1,2}:\d{2}(?::\d{2})?|\d+(?:\.\d+)?\s*(?:mb|s|sec|degrees?)|mkv|mov|webm|mp4|mp3|flac|wav|16:9|9:16|1:1)/i
  );
  if (valueReversal) {
    const oldVal = valueReversal[1].trim();
    const newVal = valueReversal[2].trim();
    corrections.push({ from: oldVal, to: newVal, reason: 'Replaced earlier value with self-correction' });
    cleaned = cleaned.replace(valueReversal[0], newVal).replace(/\s+/g, ' ').trim();
  }

  // Action replacement: "compress it instead convert to mp3"
  const actionInstead = cleaned.match(/^(.+?)\s*\b(?:actually|instead|rather|balki)\b\s+(?:just\s+)?(.+)$/i);
  if (actionInstead && !/\b(?:smaller|larger|10\s*mb|16\s*mb|25\s*mb|\d+:\d+)\b/i.test(actionInstead[2])) {
    const secondClause = actionInstead[2].trim();
    if (/\b(extract|trim|cut|compress|merge|redact|summarize|convert|unlock|lock|rotate|ocr)\b/i.test(secondClause)) {
      corrections.push({
        from: actionInstead[1].trim(),
        to: secondClause,
        reason: 'Followed updated action instruction',
      });
      cleaned = secondClause;
    }
  }

  // 4. Hinglish & bilingual intent normalization (append canonical cues without wiping domain nouns)
  let normalizedEnglish = cleaned;
  let hinglishDetected = false;
  for (const [pattern, replacement] of HINGLISH_PHRASE_MAP) {
    if (pattern.test(normalizedEnglish)) {
      hinglishDetected = true;
      normalizedEnglish = normalizedEnglish.replace(pattern, replacement);
    }
  }
  normalizedEnglish = normalizedEnglish.replace(/\s+/g, ' ').trim();

  // 5. Extract structured media/PDF parameters
  const clockTimes = normalizedEnglish.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || [];
  const wordTimes: string[] = [];
  const secMatches = Array.from(normalizedEnglish.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/gi));
  for (const m of secMatches) {
    wordTimes.push(secondsToClock(Number(m[1])));
  }
  const minMatches = Array.from(normalizedEnglish.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/gi));
  for (const m of minMatches) {
    wordTimes.push(secondsToClock(Number(m[1]) * 60));
  }
  const extractedTimesSec = clockTimes.length > 0 ? clockTimes : wordTimes;

  const sizeMatch = normalizedEnglish.match(/\b(\d+(?:\.\d+)?)\s*(?:mb|megabytes?)\b/i);
  let extractedSizeMb = sizeMatch ? Math.max(1, Math.round(Number(sizeMatch[1]))) : undefined;
  if (!extractedSizeMb && /\bdiscord\b/i.test(normalizedEnglish)) extractedSizeMb = 10;
  if (!extractedSizeMb && /\bwhatsapp\b/i.test(normalizedEnglish)) extractedSizeMb = 16;

  const fmtMatch = normalizedEnglish.match(/\b(mp3|flac|wav|aac|ogg|m4a|mp4|mkv|mov|webm|docx|pdf|png|jpg|csv)\b/i);
  const extractedFormat = fmtMatch ? fmtMatch[1].toLowerCase() : undefined;

  let extractedAspect: NormalizedUtterance['extractedAspect'];
  if (/\b9:16|vertical|reels|shorts|tiktok\b/i.test(normalizedEnglish)) extractedAspect = '9:16';
  else if (/\b16:9|widescreen|youtube|landscape\b/i.test(normalizedEnglish)) extractedAspect = '16:9';
  else if (/\b1:1|square|instagram\b/i.test(normalizedEnglish)) extractedAspect = '1:1';
  else if (/\b4:5|portrait\b/i.test(normalizedEnglish)) extractedAspect = '4:5';

  // 6. Coreference / Ordinal extraction
  let ordinalRef: NormalizedUtterance['ordinalRef'];
  if (/\b(last\s*(?:result|output|file)|that\s*output|generated\s*one)\b/i.test(normalizedEnglish)) {
    ordinalRef = 'previous_output';
  } else if (/\b(first\s*(?:one|file|pdf|video|clip)?|1st)\b/i.test(normalizedEnglish)) {
    ordinalRef = 'first';
  } else if (/\b(second\s*(?:one|file|pdf|video|clip)?|2nd)\b/i.test(normalizedEnglish)) {
    ordinalRef = 'second';
  } else if (/\b(third\s*(?:one|file|pdf|video|clip)?|3rd)\b/i.test(normalizedEnglish)) {
    ordinalRef = 'third';
  } else if (/\b(all\s*(?:of\s*)?(?:them|files|pdfs)|every\s*file|both)\b/i.test(normalizedEnglish)) {
    ordinalRef = 'all';
  } else if (/\b(last\s*(?:file|pdf|video|one))\b/i.test(normalizedEnglish)) {
    ordinalRef = 'last';
  }

  const isFollowUpTweak =
    /\b(make\s*it\s*(?:smaller|bigger|tighter)|try\s*(?:again|smaller|grayscale|lossless)|redo|do\s*that\s*again|instead|even\s*smaller|at\s*\d+\s*mb)\b/i.test(
      normalizedEnglish
    ) || Boolean(ordinalRef === 'previous_output');

  const isAffirmation = /^(?:yes|yeah|yep|yup|sure|go\s*ahead|do\s*it|proceed|confirm|ok|okay|haan|kar\s*do)[!.\s]*$/i.test(
    cleaned
  );
  const isNegation = /^(?:no|nope|cancel|stop|don'?t|abort|wait|ruko|mat\s*karo)[!.\s]*$/i.test(cleaned);

  return {
    raw,
    cleaned,
    normalizedEnglish,
    corrections,
    extractedTimesSec,
    extractedSizeMb,
    extractedFormat,
    extractedAspect,
    ordinalRef,
    isFollowUpTweak,
    isAffirmation,
    isNegation,
    hinglishDetected,
  };
}
