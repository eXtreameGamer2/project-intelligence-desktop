const SEVERITY_PRIORITY = {
  critical: 1,
  high: 1,
  p1: 1,
  blocker: 1,
  medium: 2,
  p2: 2,
  normal: 2,
  low: 3,
  p3: 3,
  minor: 3,
};

/**
 * Unused fallback. Do not call this when AI is unreachable.
 * Older imports used `source | severity | feedback` pipe rows; current imports use labeled RECORD fields.
 * @param {string} content
 * @returns {Array<{ title: string, description?: string, priority: number }>}
 */
export function extractHeuristicActionItems(content) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];

  for (const line of lines) {
    if (/^source\s*\|/i.test(line) || /^[-=|_]+$/.test(line)) {
      continue;
    }

    const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
    let title = line;
    let description;
    let priority = 2;

    if (parts.length >= 3) {
      const severity = parts[1].toLowerCase();
      priority = SEVERITY_PRIORITY[severity] || 2;
      title = parts.slice(2).join(' — ');
      description = `Reported from ${parts[0]} (${parts[1]}).`;
    } else if (parts.length === 2) {
      title = parts[1];
      description = `Reported from ${parts[0]}.`;
    }

    title = title.slice(0, 180).trim();
    if (!title) {
      continue;
    }

    items.push({
      title,
      description,
      priority,
    });
  }

  return items.slice(0, 40);
}

export default { extractHeuristicActionItems };
