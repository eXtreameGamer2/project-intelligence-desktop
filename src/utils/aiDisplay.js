const THINK_TAGS = ['think', 'thinking', 'reasoning', 'reflection', 'thought'];
const THINK_CLOSE = /<\/(?:think|thinking|reasoning|reflection|thought)>/i;
const THINK_OPEN = /<(?:think|thinking|reasoning|reflection|thought)\b[^>]*>/i;

function stripTaggedBlocks(text, tag) {
  const closed = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi');
  const leftover = new RegExp(`</?${tag}\\b[^>]*>`, 'gi');
  return String(text || '').replace(closed, '').replace(leftover, '');
}

export function looksLikeMachineReply(raw) {
  const text = String(raw || '').trim();
  if (!text) return true;
  if (/^\s*PERMISSION:\s*(yes|no)\b/im.test(text) && text.length < 120) return true;
  if (/create\|update\|delete/i.test(text) && /YYYY-MM-DD|kind|allDay/i.test(text)) return true;
  if (/^```/.test(text) && /```$/.test(text) && /"action"\s*:/i.test(text)) return true;
  if (/^[\s[\]{},:"'\d.\-_|]+$/.test(text)) return true;
  if ((/^\{[\s\S]*\}$/.test(text) || /^\[[\s\S]*\]$/.test(text)) && /"action"\s*:/i.test(text)) {
    return true;
  }
  if (/"action"\s*:/.test(text) && /"start"\s*:/.test(text) && text.length < 400) return true;
  return false;
}

export function looksLikeLeakedReasoning(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  const probe = (stripHiddenReasoning(text).trim() || text).slice(0, 400);
  if (/^\s*(okay[,.]?\s*)?(thinking process|analyze the request|rule check|analyze the dump content)\s*:/im.test(probe)) {
    return true;
  }
  if (
    /^(okay[,.]?\s*)?(the user is asking|the user (asked|wants|said)|this falls under the rule|let me think|i need to (check|analyze|look|list))\b/i.test(
      probe
    )
  ) {
    return true;
  }
  if (/this falls under the rule/i.test(text)) return true;
  if (/Analyze the Request:/i.test(text) && /(?:Rule Check:|Analyze the Dump Content:)/i.test(text)) {
    return true;
  }
  return false;
}

export function looksLikeTruncatedReply(raw) {
  const text = String(raw || '').trim();
  if (!text || text.length < 24) return false;
  const quotes = (text.match(/"/g) || []).length;
  if (quotes % 2 === 1) return true;
  if (/:\s*$/.test(text)) return true;
  if (/\b(every|the|a|an|to|and|or|of|for|with|from|which|if they asked|list)\s*$/i.test(text)) {
    return true;
  }
  if (/,\s*[\w][\w'’\-]{0,24}$/.test(text) && !/[.!?)]$/.test(text)) return true;
  return false;
}

export function looksLikeScratchpad(text) {
  const value = String(text || '').trim();
  if (looksLikeLeakedReasoning(value)) return true;
  if (value.length < 280) return false;
  const hits = (
    value.match(
      /\b(I need to|Let me think|The user (asked|wants|said)|I should output|I'll produce JSON|chain of thought|Okay, I)\b/gi
    ) || []
  ).length;
  const iCount = (value.match(/\bI\b/g) || []).length;
  if (hits >= 2 || iCount >= 6) return true;
  return (
    value.length > 900 &&
    (THINK_OPEN.test(value) || /"action"\s*:/.test(value) || /PERMISSION:/i.test(value))
  );
}

export function needsDiscussRetry(raw) {
  if (looksLikeLeakedReasoning(raw) || looksLikeTruncatedReply(raw)) return true;
  if (visibleAssistantReply(raw)) return false;
  const text = String(raw || '');
  return THINK_OPEN.test(text) || isResponseDump(text);
}

export function isResponseDump(raw) {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (looksLikeLeakedReasoning(text)) return true;
  if (looksLikeTruncatedReply(text) && looksLikeLeakedReasoning(text)) return true;
  if (/^\s*Thinking Process:/im.test(text)) return true;
  if (/Analyze the Request:/i.test(text) && /(?:Rule Check:|Analyze the Dump Content:)/i.test(text)) return true;
  if (THINK_OPEN.test(text) || THINK_CLOSE.test(text)) return true;
  if (looksLikeMachineReply(text)) return true;
  if (looksLikeScratchpad(text)) return true;
  if (/^\s*PERMISSION:\s*(yes|no)\b/im.test(text)) return true;
  if (/\bCALENDAR\b/i.test(text) && /"action"\s*:/.test(text) && text.length > 500) return true;
  if (/\bAPPROACH\b/i.test(text) && /"action"\s*:/.test(text) && text.length > 400) return true;
  return false;
}

export function dumpAsksPermission(raw) {
  const text = String(raw || '');
  return /\b(want me to (add|schedule|put|book|delete|remove|change)|should I (add|schedule|put|book|delete|remove|change)|may I (add|schedule|delete)|do you want me to|if you (want|ok|okay|approve|confirm) (me to )?(add|schedule|put|delete)|can I (add|schedule|put|book|change|delete))\b/i.test(
    text
  );
}

export function dumpRecoveryFallback({
  askedCalendar = false,
  askedDelete = false,
  handoff = '',
} = {}) {
  if (handoff) return handoff;
  if (askedDelete) {
    return 'I can remove that approach. Reply **yes** to delete it, or say which approach to delete.';
  }
  if (askedCalendar) {
    return 'I could not finish that calendar change. Reply with the **title and time** — for example, Staff standup Tuesday 9am.';
  }
  return 'I hid a messy draft. Tell me what you want in one sentence — for example, schedule this Tuesday at 9, or how to staff this work.';
}

export function explainsHowToRespond(raw) {
  return /\breply \*\*yes\*\*|\breply yes\b|tell me (a different|the title|what to change|which approach)/i.test(
    String(raw || '')
  );
}

export function stripHiddenReasoning(raw) {
  let text = String(raw || '').replace(/\r\n/g, '\n');
  const close = text.match(THINK_CLOSE);
  if (close) {
    const tail = text
      .slice(close.index + close[0].length)
      .replace(THINK_OPEN, '')
      .replace(THINK_CLOSE, '')
      .trim();
    if (tail) {
      return tail.replace(/<\|[^|\n]{1,48}\|>/g, '');
    }
  }
  for (const tag of THINK_TAGS) {
    text = stripTaggedBlocks(text, tag);
  }
  return text.replace(/<\|[^|\n]{1,48}\|>/g, '');
}

export function sanitizeAssistantReply(raw) {
  let text = stripHiddenReasoning(raw);
  text = text.replace(/^\s*PERMISSION:\s*(yes|no)\b.*$/gim, '');
  text = text.replace(/(?:^|\n)\s*CALENDAR\s*:?\s*[\s\S]*$/i, '\n');
  text = text.replace(/(?:^|\n)\s*APPROACH\s*:?\s*[\s\S]*$/i, '\n');
  text = text.replace(/```(?:json)?\s*[\s\S]*?```/gi, '');
  text = text.replace(/\[[\s\S]*?"action"\s*:\s*"?[\w|]+[\s\S]*?\]/gi, '');
  text = text.replace(/\{[^{}]*"action"\s*:[^{}]*\}/g, '');
  text = text.replace(/\{[^{}]*create\|update\|delete[^{}]*\}/g, '');
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function recoverInnerThink(raw) {
  const match = String(raw || '').match(
    /<(?:think|thinking|reasoning|reflection|thought)\b[^>]*>([\s\S]*?)<\/(?:think|thinking|reasoning|reflection|thought)>/i
  );
  if (!match?.[1]) return '';
  return sanitizeAssistantReply(match[1]);
}

export function visibleAssistantReply(raw) {
  const cleaned = sanitizeAssistantReply(raw);
  if (cleaned && !looksLikeMachineReply(cleaned) && !isResponseDump(cleaned)) {
    return cleaned;
  }
  const inner = recoverInnerThink(raw);
  if (inner && !looksLikeMachineReply(inner) && !isResponseDump(inner)) {
    return inner;
  }
  return '';
}

export function displayAssistantContent(raw, { pendingCalendar = false } = {}) {
  const visible = visibleAssistantReply(raw);
  let text = visible;
  if (!text) {
    if (!String(raw || '').trim()) return '';
    if (dumpAsksPermission(raw) || pendingCalendar) {
      return pendingCalendar
        ? 'I can make that calendar change. Reply **yes** to do it, or tell me a different title or time.'
        : 'I can make a calendar change from that draft. Reply **yes** to do it, or tell me the title and time.';
    }
    if (isResponseDump(raw) || looksLikeMachineReply(sanitizeAssistantReply(raw))) {
      return dumpRecoveryFallback();
    }
    text = sanitizeAssistantReply(raw);
  }
  text = String(text || '')
    .replace(/^\s*PERMISSION:\s*(yes|no)\b.*$/gim, '')
    .replace(/This was an internal dump[\s\S]*$/i, dumpRecoveryFallback())
    .replace(/This draft was asking for (a schedule change|your OK on a schedule change)[\s\S]*$/i, () =>
      pendingCalendar
        ? 'I can make that calendar change. Reply **yes** to do it, or tell me a different title or time.'
        : dumpRecoveryFallback({ askedCalendar: true })
    )
    .trim();
  if (pendingCalendar) return text;
  return text
    .replace(
      /\n*(?:I can put this(?:es)? on the calendar\. Confirm (?:it|them) below if that looks right:|Use the Confirm buttons? at the top if (?:that|those) look(?:s)? right:)[\s\S]*$/i,
      ''
    )
    .replace(/Use Confirm below if a card is shown\.?/gi, '')
    .trim();
}
