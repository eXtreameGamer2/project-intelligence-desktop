import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import FileDropZone from './FileDropZone';
import ReportApproachTree from './ReportApproachTree';
import SavedSuggestionsPanel from './SavedSuggestionsPanel';
import DiscussModal from './DiscussModal';
import ProjectCalendar from './ProjectCalendar';
import EmptyProjectsState from './EmptyProjectsState';

const InsightCharts = lazy(() => import('./InsightCharts'));

function ChartsFallback() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel h-[88px] animate-pulse" />
        <div className="panel h-[88px] animate-pulse" />
        <div className="panel h-[88px] animate-pulse" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="panel h-72 animate-pulse" />
        <div className="panel h-72 animate-pulse" />
      </div>
    </div>
  );
}

export default function MainPanel({
  project,
  reports,
  actionItems,
  calendar,
  calendarProposals,
  onUpload,
  onToggleItem,
  onRenameReport,
  onExpandReport,
  onDeleteReport,
  onDeleteItem,
  expandingReportId,
  importFocus,
  onImportFocusChange,
  onCancelImport,
  onLoadSuggestions,
  onDiscuss,
  onSaveSuggestion,
  onUnsaveSuggestion,
  onCompleteSuggestion,
  onAnalyzeItemFile,
  onHydrateItem,
  onCreateCalendar,
  onUpdateCalendar,
  onDeleteCalendar,
  focusCalendarId,
  onCalendarFocused,
  focusApproachId,
  onApproachFocused,
  onApplyProposal,
  onDismissProposal,
  proposalBusyId,
  proposalError,
  isUploading,
  isUpdatingId,
  suggestingId,
  discussingId,
  savingKey,
  analyzingSavedId,
  aiProgress,
  importProgress,
  isLoading,
  multiPass = false,
  passCount = 1,
  hasProjects = false,
  onCreateProject,
  isCreating = false,
  reasoningEnabled = true,
  onReasoningChange,
  showReasoning = false,
}) {
  const [openItemId, setOpenItemId] = useState(null);
  const [focusSavedId, setFocusSavedId] = useState(null);
  const openItem = actionItems.find((item) => item.id === openItemId);
  const onApproachFocusedRef = useRef(onApproachFocused);
  onApproachFocusedRef.current = onApproachFocused;

  const openApproach = (itemId, savedId = null) => {
    setOpenItemId(itemId);
    setFocusSavedId(savedId);
    onHydrateItem?.(itemId);
  };

  const closeApproach = () => {
    setOpenItemId(null);
    setFocusSavedId(null);
  };

  useEffect(() => {
    if (!focusApproachId) return;
    if (!actionItems.some((item) => item.id === focusApproachId)) return;
    openApproach(focusApproachId);
    onApproachFocusedRef.current?.();
  }, [focusApproachId, actionItems]);

  if (isLoading && !project) {
    return (
      <main className="panel flex min-h-[32rem] flex-1 items-center justify-center p-10">
        <p className="text-sm text-slate-400">Loading project data…</p>
      </main>
    );
  }

  if (!project) {
    if (!hasProjects) {
      return (
        <EmptyProjectsState
          onCreateProject={onCreateProject}
          isCreating={isCreating}
        />
      );
    }

    return (
      <main className="panel flex min-h-[32rem] flex-1 items-center justify-center p-10">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-semibold text-white">Select a Project Container</h2>
          <p className="mt-2 text-sm text-slate-400">
            Choose a project from the sidebar. Each container keeps reports and action
            items strictly isolated.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
      {isLoading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center pt-10">
          <p className="rounded-full border border-slate-800 bg-surface-950/90 px-3 py-1 text-xs text-slate-400">
            Updating…
          </p>
        </div>
      )}
      <div className="panel px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Active Container
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-white">{project.name}</h2>
      </div>

      <FileDropZone
        onUpload={onUpload}
        isUploading={isUploading}
        aiProgress={importProgress || aiProgress}
        disabled={!project}
        multiPass={multiPass}
        passCount={passCount}
        importFocus={importFocus}
        onImportFocusChange={onImportFocusChange}
        onCancel={onCancelImport}
      />

      <ProjectCalendar
        projectName={project.name}
        entries={calendar || []}
        proposals={calendarProposals || []}
        actionItems={actionItems || []}
        onCreate={onCreateCalendar}
        onUpdate={onUpdateCalendar}
        onDelete={onDeleteCalendar}
        onOpenApproach={openApproach}
        focusEntryId={focusCalendarId}
        onFocusHandled={onCalendarFocused}
        onApplyProposal={onApplyProposal}
        onDismissProposal={onDismissProposal}
        proposalBusyId={proposalBusyId}
        proposalError={proposalError}
      />

      <Suspense fallback={<ChartsFallback />}>
        <InsightCharts actionItems={actionItems} reports={reports} />
      </Suspense>

      <SavedSuggestionsPanel
        items={actionItems}
        onOpenSuggestion={openApproach}
        onCompleteSuggestion={onCompleteSuggestion}
        completingKey={savingKey}
      />

      <ReportApproachTree
        key={project.id}
        reports={reports}
        items={actionItems}
        onToggle={onToggleItem}
        onOpenItem={openApproach}
        onRenameReport={onRenameReport}
        onExpandReport={onExpandReport}
        onDeleteReport={onDeleteReport}
        onDeleteItem={onDeleteItem}
        expandingReportId={expandingReportId}
        isUpdatingId={isUpdatingId}
      />

      {openItem && (
        <DiscussModal
          item={openItem}
          proposals={(calendarProposals || []).filter(
            (proposal) => proposal.itemId === openItem.id || proposal.source === 'discussion'
          )}
          onClose={closeApproach}
          onDiscuss={onDiscuss}
          onLoadSuggestions={onLoadSuggestions}
          onSaveSuggestion={onSaveSuggestion}
          onUnsaveSuggestion={onUnsaveSuggestion}
          onCompleteSuggestion={onCompleteSuggestion}
          onAnalyzeFile={onAnalyzeItemFile}
          onApplyProposal={onApplyProposal}
          onDismissProposal={onDismissProposal}
          onDeleteItem={onDeleteItem}
          isDeleting={isUpdatingId === openItem.id}
          proposalBusyId={proposalBusyId}
          proposalError={proposalError}
          isSuggesting={suggestingId === openItem.id}
          isDiscussing={discussingId === openItem.id}
          savingKey={savingKey}
          analyzingSavedId={analyzingSavedId}
          focusSavedId={focusSavedId}
          aiProgress={aiProgress}
          reasoningEnabled={reasoningEnabled}
          onReasoningChange={onReasoningChange}
          showReasoning={showReasoning}
        />
      )}
    </main>
  );
}
