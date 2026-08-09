/**
 * BoundBuild MVP — AI structuring pipeline.
 *
 * v1 ships with a deterministic extraction engine (works offline, zero API cost,
 * fully transparent). If an OPENAI_API_KEY is set in .env, the same request is
 * routed to an LLM for higher-quality structured drafts — the schema is identical,
 * so the UI never changes.
 */

const EVENT_TYPES = [
  'Variation', 'Delay', 'Site instruction', 'Scope change',
  'Unforeseen condition', 'Material substitution', 'Other commercial event',
];

const TYPE_KEYWORDS = [
  { type: 'Unforeseen condition', words: ['unforeseen', 'rock', 'contaminated', 'unexpected', 'buried', 'asbestos', 'groundwater', 'not on the plans', 'not shown on', 'boulder', 'hard fill', 'old slab', 'rebar found', 'services not as built'] },
  { type: 'Delay', words: ['delay', 'delayed', 'behind schedule', 'held up', 'waiting on', 'stopped work', 'can\'t proceed', 'cannot proceed', 'no access', 'weather', 'rain', 'wet site', 'wet weather', 'stand down', 'down time', 'downtime', 'late delivery', 'hold up'] },
  { type: 'Material substitution', words: ['substitut', 'swap the', 'replace the material', 'change of material', 'different timber', 'alternative product', 'equivalent', 'upgrade the', 'downgrade'] },
  { type: 'Site instruction', words: ['instruction', 'instructed', 'directed', 'asked us to', 'told us to', 'requested we', 'verbally instructed', 'site instruction', 'change to the way'] },
  { type: 'Scope change', words: ['scope', 'extra work', 'additional work', 'more work', 'not in the contract', 'out of scope', 'add to the', 'extra room', 'moved the wall', 'changed the layout', 'add an extra'] },
  { type: 'Variation', words: ['variation', 'var', 'extra cost', 'extra for', 'quote for', 'price for', 'cost for', 'claim', 'charge extra', 'additional cost'] },
];

const INSTRUCTED_HINTS = [
  'architect', 'engineer', 'structural engineer', 'client', 'builder', 'PM', 'project manager',
  'QS', 'quantity surveyor', 'site manager', 'foreman', 'supervisor', 'council', 'inspector',
  'BCO', 'consultant', 'planner', 'subbie', 'subcontractor', 'main contractor', 'owner',
];

const NAME_WORDS = /^[A-Z][a-z]{1,14}$/; // rough capitalized-name detector

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function detectType(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  // Score by keyword hits; earliest + longest phrases win.
  let best = null;
  for (const group of TYPE_KEYWORDS) {
    let score = 0;
    for (const w of group.words) {
      if (t.includes(w.toLowerCase())) score += w.split(' ').length * 2;
    }
    if (score > 0 && (!best || score > best.score)) best = { type: group.type, score };
  }
  return best ? best.type : 'Other commercial event';
}

function extractTitle(text) {
  const firstSentence = clean(text).split(/(?<=[.!?])\s+/)[0] || '';
  let title = firstSentence;
  // Trim leading filler like "um, so, yeah"
  title = title.replace(/^(um+|uh+|er+|so+|yeah+|ok+)[,\s]+/i, '');
  if (title.length > 90) title = title.slice(0, 87).trimEnd() + '…';
  // Sentence-case-ish for readability
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (!title) title = 'Site event';
  return title;
}

function extractInstructedBy(text) {
  const lower = text.toLowerCase();
  for (const hint of INSTRUCTED_HINTS) {
    const re = new RegExp(`(?:instructed by|directed by|asked by|per (?:the |our )?|from the |with the )?(${hint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i');
    // Prefer "instructed by X" pattern
    const m = text.match(new RegExp(`(?:instructed by|directed by|asked (?:us )?by|per)\\s+(?:the\\s+)?([A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+)?)`, 'i'));
    if (m) return m[1];
    if (re.test(text)) {
      const m2 = text.match(new RegExp(`\\b(${hint.replace(/[. ]/g, '[ .]?')})\\b`, 'i'));
      if (m2) {
        const found = m2[0];
        return found.charAt(0).toUpperCase() + found.slice(1).toLowerCase();
      }
    }
  }
  // Generic: "X asked/told us"
  const m = text.match(/([A-Z][a-z]{2,14}\s+[A-Z][a-z]{2,14}|[A-Z][a-z]{2,14})\s+(asked|told|said|instructed|directed)\s+(us|me|the team)/i);
  if (m) return m[1];
  return '';
}

function extractTimeImpact(text) {
  const lower = text.toLowerCase();
  const m = lower.match(/(\d+)\s*[-–]?\s*(\d+)?\s*(days?|day\s*s|weeks?|week\s*s|months?|month\s*s|hours?|hour\s*s)/);
  if (m) {
    const unit = m[3].replace(/\s+/g, '');
    const span = m[2] ? `${m[1]}–${m[2]} ${unit}` : `${m[1]} ${unit}`;
    const note = `Est. ${span} (from voice note)`;
    return { flag: true, note };
  }
  if (/\b(delays?|will take|sets us back|pushes (us|the)?\s*(programme|program|schedule))\b/.test(lower)) {
    return { flag: true, note: 'Time impact flagged in voice note — confirm duration' };
  }
  return { flag: false, note: '' };
}

function extractCostImpact(text) {
  const lower = text.toLowerCase();
  if (/\b(\$\s?\d|cost\b|quote|priced?|extra\b|charge|claim|rate)\b/.test(lower)) {
    const m = text.match(/(?:\$|nz\$)\s?\d[\d,]*\.?\d*/);
    return { flag: true, note: m ? `Amount mentioned: ${m[0]}` : 'Cost impact flagged in voice note — value to be quantified' };
  }
  return { flag: false, note: '' };
}

function extractLocation(text, project) {
  // Try "in the X" / "at the X" patterns where X looks like a place
  const m = text.match(/\b(?:in|at|on)\s+the\s+([a-z][a-z0-9\- ]{2,30}?)(?:\s*[,.;]|\s+(?:and|but|so|we|they|the|there|this|it|as|when)\b|$)/i);
  if (m) {
    const loc = m[1].trim();
    // Heuristic: reject phrases that are clearly not locations
    if (!/\b(week|day|morning|afternoon|meeting|phone|moment|end|same|time|way|order|future|past|meantime|drawings|plans|paper|contract|phone|site|job|project|list|schedule|programme|program)\b/i.test(loc)) {
      return loc.charAt(0).toUpperCase() + loc.slice(1);
    }
  }
  if (project && project.location) return '';
  return '';
}

function extractSummary(text) {
  const t = clean(text);
  if (t.length > 600) return t.slice(0, 597) + '…';
  return t;
}

function structureTranscript({ transcript, project, eventTypeHint }) {
  const text = clean(transcript);
  const type = EVENT_TYPES.includes(eventTypeHint) ? eventTypeHint : detectType(text);
  const instructedBy = extractInstructedBy(text);
  const timeImpact = extractTimeImpact(text);
  const costImpact = extractCostImpact(text);
  const location = extractLocation(text, project);
  const summary = extractSummary(text);

  const filled = [type !== 'Other commercial event', !!instructedBy, timeImpact.flag, costImpact.flag, !!location];
  const confidence = Math.round((2 + filled.filter(Boolean).length) / 7 * 100); // title+summary always filled

  return {
    title: extractTitle(text),
    type,
    summary,
    location,
    instructedBy,
    timeImpact,
    costImpact,
    confidence: Math.min(confidence, 98),
    engine: 'heuristic-v1',
  };
}

/**
 * Optional LLM path. Returns the same shape as structureTranscript when
 * OPENAI_API_KEY is configured; otherwise null (caller falls back to heuristic).
 */
async function structureWithLLM(transcript, project) {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You structure construction site voice notes into commercial event drafts. ' +
              'Return strict JSON only: {title, type, summary, location, instructedBy, timeImpact:{flag,note}, costImpact:{flag,note}, confidence}. ' +
              `Event types: ${EVENT_TYPES.join(', ')}. Confidence = 0-100 how certain the draft is correct. ` +
              'Keep summary a clean 1-3 sentence professional description. Flag impacts only when there is evidence in the note. ' +
              'If a field cannot be inferred, use empty string. Never invent facts.',
          },
          {
            role: 'user',
            content: `Project: ${project ? project.name + ' — ' + project.location : 'n/a'}\nVoice note: ${transcript}`,
          },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error('LLM HTTP ' + res.status);
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return { ...parsed, engine: 'llm', title: parsed.title || 'Site event' };
  } catch (e) {
    console.error('LLM structuring failed, falling back to heuristic:', e.message);
    return null;
  }
}

module.exports = { EVENT_TYPES, structureTranscript, structureWithLLM };
