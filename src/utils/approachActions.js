import { isolateJsonArray, repairJsonSyntax } from './jsonRepair.js';
import { resolveApproach } from './calendar.js';

export function userAskedToDeleteApproach(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/\b(delete|remove|discard|drop|get rid of)\b.{0,80}\bapproaches?\b/i.test(value)) return true;
  if (/\bapproaches?\b.{0,40}\b(delete|remove|discard|drop|get rid of)\b/i.test(value)) return true;
  if (/\b(calendar|meeting|event|appointment|schedule|unschedule|standup)\b/i.test(value)) {
    return false;
  }
  return /\b(delete|remove|discard|drop|get rid of)\s+(this|that|it)\b/i.test(value);
}

export function approachDeletePrompt() {
  return [
    'If the user asked to delete or remove an approach (not a calendar item), they already approved it.',
    'After the reply write APPROACH and a JSON array of real values only. Example:',
    'APPROACH',
    '[{"action":"delete","approach":1}]',
    'approach is the numbered approach from APPROACHES. When discussing one approach, omit approach or set it to that approach.',
    'The approach is removed immediately. Do not ask for permission or confirmation. If they did not ask to delete an approach, omit APPROACH.',
  ].join('\n');
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function splitApproachReply(raw) {
  const text = String(raw || '').trim();
  const marker = text.search(/(?:^|\n)\s*APPROACH\b\s*:?/i);
  if (marker >= 0) {
    return text.slice(marker).replace(/^\s*APPROACH\s*:?\s*/i, '').trim();
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && /"action"\s*:\s*"?delete/i.test(fenced[1]) && /"approach"\s*:/i.test(fenced[1])) {
    return fenced[1];
  }
  return '';
}

function isDeleteShape(parsed) {
  if (!parsed || typeof parsed !== 'object') return false;
  const action = String(parsed.action || '').toLowerCase();
  return action === 'delete' || action === 'remove';
}

export function extractApproachDeletes(raw, context = {}) {
  const slice = splitApproachReply(raw) || (/"action"\s*:\s*"?(delete|remove)\b/i.test(raw) ? String(raw || '') : '');
  const isolated = isolateJsonArray(slice);
  let parsed = isolated
    ? tryParseJson(isolated) || tryParseJson(repairJsonSyntax(isolated))
    : tryParseJson(slice.trim()) || tryParseJson(repairJsonSyntax(slice.trim()));
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') parsed = [parsed];
  if (!Array.isArray(parsed)) parsed = [];

  const approaches = context.approaches || [];
  const extras = context.userMessage || '';
  const found = [];
  const seen = new Set();
  for (const entry of parsed) {
    if (!isDeleteShape(entry) && String(entry?.action || '').toLowerCase() !== 'delete') continue;
    const matched =
      resolveApproach(
        entry.approach ?? entry.item ?? entry.itemId ?? entry.approachId ?? entry.id ?? entry.title,
        approaches,
        extras
      ) || (context.defaultItemId ? approaches.find((row) => row.id === context.defaultItemId) : null);
    if (!matched?.id || seen.has(matched.id)) continue;
    seen.add(matched.id);
    found.push({ id: matched.id, title: matched.title, projectId: matched.projectId });
    if (found.length >= 8) break;
  }
  return found;
}

export function formatApproachDeletedConfirmation(deleted = []) {
  if (!deleted.length) return '';
  if (deleted.length === 1) {
    return `Done. **${deleted[0].title || 'That approach'}** is removed.`;
  }
  return `Done. Removed:\n${deleted.map((row) => `- **${row.title || 'Approach'}**`).join('\n')}`;
}
