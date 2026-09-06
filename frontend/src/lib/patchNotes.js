const LAST_SEEN_KEY = 'cpid-last-seen-version';

export const CURRENT_APP_VERSION = '1.0.32';

export const PATCH_NOTES = [
  {
    version: '1.0.31',
    date: '2026-09-05',
    title: 'Patch notes grouped by day',
    changes: [
      'Patch notes group multiple versions that ship on the same day under one date heading.',
      'Earlier history expands by day, with a count of versions in each group.',
    ],
  },
  {
    version: '1.0.30',
    date: '2026-09-05',
    title: 'Approaches, charts, and updates',
    changes: [
      'Long approach titles and descriptions wrap or scroll instead of being cut off.',
      'Open approaches by file chart labels use full names and wrap across lines.',
      'The discuss window stays inside the app frame; long sections scroll.',
      'Test Connection works with an empty optional API key on Local.',
      'When an update is available, Dashboard and Overview show a clearer Update button that opens Settings at the Updates section.',
    ],
  },
  {
    version: '1.0.29',
    date: '2026-09-05',
    title: 'Security patch',
    changes: [
      'Security patch',
    ],
  },
  {
    version: '1.0.28',
    date: '2026-09-05',
    title: 'Security patch',
    changes: [
      'Security patch',
    ],
  },
  {
    version: '1.0.27',
    date: '2026-08-27',
    title: 'Security patch',
    changes: [
      'Security patch',
    ],
  },
  {
    version: '1.0.26',
    date: '2026-08-19',
    title: 'Import windows, data files, and chat reasoning',
    changes: [
      'Large files are read in sequential parts when they exceed the model’s loaded context. A notice appears on that import, and the progress countdown continues across those parts.',
      'CSV, Excel, ODS, JSON, and HTML need Improve from past jobs plus multi-pass with 4 to 8 passes.',
      'Word, PDF, PowerPoint, and text still import on a normal one-pass run.',
      'Excel workbooks (.xlsx, .xlsm, .xls) are supported again under that multi-pass rule.',
      'Dashboard and Overview have a Reasoning switch for chats only. Imports and other jobs never use reasoning.',
      'Import approaches are taken from work in the file, not invented from column names or page/table titles.',
      'The always-on context-limit hint under Settings and the importer is gone. The overflow notice still appears when an import is actually split.',
    ],
  },
  {
    version: '1.0.25',
    date: '2026-08-19',
    title: 'Large imports and multi-pass data files',
    changes: [
      'Large files are read in sequential windows when they exceed the model context.',
      'CSV, Excel, ODS, JSON, and HTML imports require multi-pass with 4 to 8 passes in Settings.',
      'Word, PDF, PowerPoint, and text still import on a normal one-pass run.',
      'Reasoning stays off during imports and other non-chat jobs.',
    ],
  },
  {
    version: '1.0.24',
    date: '2026-08-16',
    title: 'Check for updates',
    changes: [
      'Settings can check GitHub for a newer installer.',
      'Installed copies can download the update and restart to apply it.',
      'A header badge appears when an update is available.',
    ],
  },
  {
    version: '1.0.23',
    date: '2026-08-16',
    title: 'More file types and a fresh Overview chat',
    changes: [
      'Import spreadsheets, Word, PDF, PowerPoint, text, Markdown, JSON, or HTML — not only .xlsx, .csv, and .docx.',
      'Start a fresh Overview portfolio chat with New chat instead of refreshing the page.',
    ],
  },
  {
    version: '1.0.22',
    date: '2026-08-16',
    title: 'Project Intelligence Local',
    changes: [
      'The app is now named Project Intelligence Local in the window, installer, and header.',
      'Rename and Delete on the left project list are combined into Manage.',
      'Deleting an approach, its file, or a project also removes the linked calendar items instead of leaving them unlinked.',
      'Dashboard and Overview AI tell you which view to use when a request belongs in the other place.',
    ],
  },
  {
    version: '1.0.21',
    date: '2026-08-16',
    title: 'AI actions apply, dumps become questions',
    changes: [
      'Delete an approach from the thread or Discuss. If you ask AI to remove it, that happens immediately.',
      'Dashboard and Overview AI no longer stall on permission for calendar or approach changes you already asked for.',
      'If the model dumps thinking or JSON, you see a short question instead — for example, reply yes or give a title and time.',
      'Dumps and dump rewrites are not saved as preferred localhost training. Clean replies and your corrections still can be.',
    ],
  },
  {
    version: '1.0.20',
    date: '2026-08-16',
    title: 'Link calendar items to approaches',
    changes: [
      'Schedule from a dropdown of project approaches so a calendar item can be linked to the exact approach.',
      'Open that approach from the calendar item or Overview upcoming list.',
      'When AI puts work on the calendar, it links the matching approach and uses its title and notes unless you asked for different wording.',
    ],
  },
  {
    version: '1.0.19',
    date: '2026-08-16',
    title: 'Imports no longer cancel themselves',
    changes: [
      'Starting an import no longer cancels the job as soon as the file is received. Cancel import still stops a run you choose to abort.',
    ],
  },
  {
    version: '1.0.18',
    date: '2026-08-16',
    title: 'Cancel imports, delete files, and unlimited local use',
    changes: [
      'Cancel an in-progress import from the progress bar, including while you are on Overview or Settings.',
      'Delete a file from Uploads and approaches. That also removes the approaches generated from it.',
      'The desktop app no longer caps reports per project or asks you to upgrade for sharing.',
      'The Settings save bar appears only when there are unsaved changes.',
    ],
  },
  {
    version: '1.0.17',
    date: '2026-08-16',
    title: 'Local imports fit the model, and Settings save is page-wide',
    changes: [
      'Large file imports no longer fail when the local model’s context is smaller than the prompt. Complete records are kept, omitted rows are marked as omitted, and the model is told not to invent them.',
      'Save Settings applies to the whole page. Leaving with unsaved changes is blocked; the save button pulses and shows that changes are unsaved.',
    ],
  },
  {
    version: '1.0.16',
    date: '2026-08-16',
    title: 'Clearer file reads and safer import repairs',
    changes: [
      'Spreadsheets and Word files are converted into labeled columns, rows, headings, and paragraphs before AI reads them. Excel formulas include the saved result and the formula text.',
      'Import progress stays at the current percent if you switch to Overview or Settings.',
      'Settings can delete saved localhost training examples. If an import reply is invalid, AI retries once from the report instead of inventing work.',
    ],
  },
  {
    version: '1.0.15',
    date: '2026-08-16',
    title: 'Background imports and targeted findings',
    changes: [
      'File imports keep running if you switch to Overview or Settings.',
      'Re-uploading the same file expands more approaches instead of saving a duplicate copy. High, Medium, and Low each cap at 10; refresh the file after those approaches are complete.',
      'Choose an import target so AI returns an overall view, bugs only, community feedback, community suggestions, or a custom focus.',
    ],
  },
  {
    version: '1.0.14',
    date: '2026-08-16',
    title: 'File approaches match the report',
    changes: [
      'Local imports no longer save the model’s thinking or numbered dump as approaches.',
      'Priority is High, Medium, or Low from the report, not P1, P2, P4, P5 from list order.',
    ],
  },
  {
    version: '1.0.13',
    date: '2026-08-16',
    title: 'Empty project screen crash',
    changes: [
      'Opening the app with no projects no longer crashes with “Cannot read properties of null (reading id)”.',
    ],
  },
  {
    version: '1.0.12',
    date: '2026-08-16',
    title: 'Empty project screen stays visible',
    changes: [
      'With no projects, the sidebar and create-project form stay on screen instead of collapsing to a blank window.',
    ],
  },
  {
    version: '1.0.11',
    date: '2026-08-16',
    title: 'Empty project screen',
    changes: [
      'With no projects, the dashboard shows a create-project form instead of a blank page.',
    ],
  },
  {
    version: '1.0.10',
    date: '2026-08-16',
    title: 'Rename and delete projects',
    changes: [
      'Rename or delete a project from the sidebar. Deleting a project removes its reports, approaches, and calendar items.',
    ],
  },
  {
    version: '1.0.9',
    date: '2026-08-16',
    title: 'Imports keep report work, not model dump text',
    changes: [
      'Approaches now come from the imported file. Prompt text, thinking, and example JSON are no longer saved as approaches.',
      'Priority is High, Medium, or Low from the report, not a numbered readout of the model reply.',
    ],
  },
  {
    version: '1.0.8',
    date: '2026-08-16',
    title: 'Multi-pass report imports',
    changes: [
      'Optional multi-pass imports save the file first, then re-read it several times to reduce missed or misread items.',
      'Multi-pass requires localhost response examples. It is slower, but those extra passes can improve training on your files.',
      'When multi-pass is off, imports still use the standard one-pass flow.',
    ],
  },
  {
    version: '1.0.7',
    date: '2026-08-16',
    title: 'Requested calendar changes apply immediately',
    changes: [
      'If you ask the AI to schedule, reschedule, delete, or mark a calendar item, it is saved right away.',
      'Confirm cards still appear when the AI volunteers a schedule change you did not ask for.',
    ],
  },
  {
    version: '1.0.6',
    date: '2026-08-16',
    title: 'Report import JSON recovery',
    changes: [
      'Imported reports recover from messy or truncated local-model JSON more reliably.',
      'If the first reply is not a valid task array, the app asks the local model once more to rewrite it as JSON.',
    ],
  },
  {
    version: '1.0.5',
    date: '2026-08-16',
    title: 'Local AI, training, and patch notes',
    changes: [
      'This app is localhost-only. Hosted OpenAI, BYOK, and custom endpoints were removed.',
      'Optional localhost response examples can improve imports, the portfolio feed, and project discussions.',
      'If you say a reply was incorrectly understood, the local AI stores that correction and avoids repeating it.',
      'As replies already match what you want, fewer training examples are sent.',
      'Patch notes now appear after each update, with the full version history available anytime.',
    ],
  },
  {
    version: '1.0.4',
    date: '2026-08-16',
    title: 'In-app New Project',
    changes: [
      'Create a project from the sidebar form. The desktop app no longer relies on a browser prompt.',
    ],
  },
  {
    version: '1.0.3',
    date: '2026-08-15',
    title: 'Report import parsing',
    changes: [
      'Imported reports recover more reliably when the local model returns messy or truncated JSON.',
    ],
  },
  {
    version: '1.0.2',
    date: '2026-08-15',
    title: 'Progress timing',
    changes: [
      'AI progress uses your local clock so the bar only moves forward, with a clearer time-left estimate.',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-08-14',
    title: 'Installer launch fix',
    changes: [
      'The Windows installer now includes the database engine so the app can start after install.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-14',
    title: 'First desktop release',
    changes: [
      'Local SQLite workspace, localhost AI, report import, overview feed, and project calendar proposals.',
    ],
  },
];

export function parseVersion(value) {
  return String(value || '0')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

export function sortedPatchNotes() {
  return [...PATCH_NOTES].sort((left, right) => compareVersions(right.version, left.version));
}

/**
 * Group version entries by calendar date (newest day first).
 * Within each day, versions stay newest-first.
 */
export function groupPatchNotesByDate(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const groups = new Map();

  for (const entry of list) {
    const date = String(entry?.date || '').trim() || 'Undated';
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(entry);
  }

  return [...groups.entries()]
    .sort((left, right) => {
      if (left[0] === 'Undated') return 1;
      if (right[0] === 'Undated') return -1;
      return String(right[0]).localeCompare(String(left[0]));
    })
    .map(([date, items]) => ({
      date,
      entries: [...items].sort((a, b) => compareVersions(b.version, a.version)),
    }));
}

export function formatPatchNoteDate(date) {
  const value = String(date || '').trim();
  if (!value || value === 'Undated') return 'Undated';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = months[Number(match[2]) - 1] || match[2];
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function patchNoteDateKey(entry) {
  return String(entry?.date || '').trim() || 'Undated';
}

/**
 * Build main + earlier sections without splitting one calendar day across both.
 * Any day represented in primaryEntries includes every version from that day.
 */
export function partitionPatchNotesForDisplay(allNotes, primaryEntries) {
  const all = Array.isArray(allNotes) ? allNotes : [];
  const primary = Array.isArray(primaryEntries) ? primaryEntries : [];
  const primaryDates = new Set(primary.map(patchNoteDateKey));
  const mainEntries = all.filter((entry) => primaryDates.has(patchNoteDateKey(entry)));
  const mainVersions = new Set(mainEntries.map((entry) => entry.version));
  const olderEntries = all.filter((entry) => !mainVersions.has(entry.version));

  return {
    mainGroups: groupPatchNotesByDate(mainEntries),
    olderGroups: groupPatchNotesByDate(olderEntries),
    olderVersionCount: olderEntries.length,
  };
}

export function readLastSeenVersion() {
  try {
    return localStorage.getItem(LAST_SEEN_KEY) || '';
  } catch {
    return '';
  }
}

export function markVersionSeen(version) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, String(version || CURRENT_APP_VERSION));
  } catch {
    // Ignore storage failures; the notice can show again next launch.
  }
}

export function notesSince(lastSeen, currentVersion) {
  const current = currentVersion || CURRENT_APP_VERSION;
  return sortedPatchNotes().filter((entry) => {
    if (compareVersions(entry.version, current) > 0) return false;
    if (!lastSeen) return entry.version === current;
    return compareVersions(entry.version, lastSeen) > 0;
  });
}

export function shouldShowPatchNotes(currentVersion) {
  const current = currentVersion || CURRENT_APP_VERSION;
  const lastSeen = readLastSeenVersion();
  if (!lastSeen) return notesSince('', current).length > 0;
  return compareVersions(current, lastSeen) > 0 && notesSince(lastSeen, current).length > 0;
}
