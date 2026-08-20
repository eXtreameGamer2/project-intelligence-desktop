import { userAskedForCalendarChange } from './calendar.js';
import { userAskedToDeleteApproach } from './approachActions.js';

export const HANDOFF_TO_OVERVIEW =
  "I can't do that from this approach thread. Open **Overview** to prioritize across projects, cluster work, or schedule the portfolio.";

export const HANDOFF_TO_DASHBOARD =
  "I can't do that from Overview. Open that project on the **Dashboard**, then discuss the approach or drop the file there for steps, file analysis, or saved suggestions.";

export const HANDOFF_TO_DASHBOARD_DELETE =
  "I can't tell which approach to remove from Overview. Open it on the **Dashboard** and delete it there, or name the numbered approach from the briefing.";

export function looksLikePortfolioWork(text) {
  return /\b(overview|portfolio|across (all |the )?projects|all projects|every project|which project|hottest queue|cluster(ing)?|stale projects?|backed[- ]?up( queues?)?|what should I (start|focus on)|prioritize (my |the )?(projects|portfolio|queues?)|(other|another|different) project)\b/i.test(
    String(text || '')
  );
}

export function looksLikeApproachWork(text) {
  return /\b(analy[sz]e (this |the |a )?(file|upload|report|spreadsheet|docx?|csv)|compare (this |the )?file|import (this |the )?(file|report)|upload (this |the )?file|saved suggestions?|implementation steps?|how (do I|to) (staff|implement|fix|do|use)\b|file comparison|write (the |me )?(steps|a procedure)|procedure( step)?|step\s*[123]|first step|second step|third step|this suggestion|this step|discuss (this|the|that) approach)\b/i.test(
    String(text || '')
  );
}

function isCrossProjectRequest(text) {
  return /\b(all projects|every project|across (all |the )?projects|(other|another|different) project|the portfolio)\b/i.test(
    String(text || '')
  );
}

function namedApproachInMessage(text) {
  return /\bapproaches?\s*#?\s*\d+\b|\bapproach\s+\d+\b/i.test(String(text || ''));
}

function isLocalThisRequest(text) {
  return /\b(this approach|this item|this meeting|this task|schedule this|put this|add this|delete this|remove this)\b/i.test(
    String(text || '')
  );
}

export function resolveDiscussHandoff({ surface, userMessage } = {}) {
  const text = String(userMessage || '');
  if (!text.trim()) return '';
  const askedDelete = userAskedToDeleteApproach(text);
  const askedCalendar = userAskedForCalendarChange(text) && !askedDelete;
  const crossProject = isCrossProjectRequest(text);
  const localThis = isLocalThisRequest(text);

  if (surface === 'dashboard') {
    if (crossProject) return HANDOFF_TO_OVERVIEW;
    if (looksLikeApproachWork(text) || localThis) return '';
    if (looksLikePortfolioWork(text) && !localThis) return HANDOFF_TO_OVERVIEW;
    if (askedCalendar || askedDelete) return '';
    if (looksLikePortfolioWork(text)) return HANDOFF_TO_OVERVIEW;
    return '';
  }

  if (looksLikeApproachWork(text) && !askedCalendar && !askedDelete) return HANDOFF_TO_DASHBOARD;
  if (askedDelete && /\b(this|that|it)\b/i.test(text) && !namedApproachInMessage(text) && !crossProject) {
    return HANDOFF_TO_DASHBOARD_DELETE;
  }
  return '';
}

export function extraScopeNote({ surface, userMessage } = {}) {
  const text = String(userMessage || '');
  const askedDelete = userAskedToDeleteApproach(text);
  const askedCalendar = userAskedForCalendarChange(text) && !askedDelete;
  if (surface === 'dashboard' && askedCalendar && looksLikePortfolioWork(text) && !isCrossProjectRequest(text)) {
    return 'For which project to start or clustering across the portfolio, open **Overview**.';
  }
  if (surface === 'overview' && askedCalendar && looksLikeApproachWork(text)) {
    return 'For steps or file analysis on that work, open it on the **Dashboard**.';
  }
  return '';
}

export function discussScopePrompt({ overview = false } = {}) {
  if (overview) {
    return [
      'Match the question to OVERVIEW BRIEFING, the listed approaches, and this Overview thread first.',
      'You handle Overview work: prioritize projects, cluster work, drain queues, notice stale projects, and schedule across the portfolio.',
      'If they ask how to do implementation steps, file analysis, saved suggestions, or a deep discussion of one approach, do not try it.',
      'Say you cannot do that here and tell them to open that project on the Dashboard, then discuss the approach or drop the file there.',
      'If the question does not match the briefing or this thread, say you do not see that here. Do not invent projects or buttons.',
    ].join(' ');
  }
  return [
    'You handle this one approach on the Dashboard: advice, the listed on-screen suggestions and saved steps, file analysis, and calendar or delete for this approach.',
    'If they mention a step, procedure, suggestion, file, or title from ON THIS APPROACH or this thread, answer it here. That is on-screen work, not Overview work.',
    'If they ask which project to start, clustering, stale projects, or scheduling across the portfolio, do not try it. Tell them to open Overview.',
    'If the question does not match this approach, the listed items, the calendar, a file analysis, or earlier messages in this thread, say you do not see that here and ask which listed item they mean. Do not invent other pages or buttons.',
  ].join(' ');
}

export function withScopeNote(result, { surface, userMessage } = {}) {
  const note = extraScopeNote({ surface, userMessage });
  if (!note || !result?.reply) return result;
  if (/\bOverview\b|\bDashboard\b/.test(result.reply)) return result;
  return { ...result, reply: `${result.reply}\n\n${note}` };
}
