import OverviewFeed from '../components/OverviewFeed';
import OverviewUpcoming from '../components/OverviewUpcoming';
import ProjectsOverview from '../components/ProjectsOverview';

export default function OverviewPage({
  overview,
  activeProjectId,
  onSelectProject,
  onOpenCalendarEntry,
  onOpenCalendarApproach,
  isChoosing,
  hasAiChoices,
  onChoose,
  feedMessages,
  calendarProposals,
  upcomingCalendar,
  isDiscussing,
  aiProgress,
  onDiscuss,
  onNewChat,
  onApplyProposal,
  onDismissProposal,
  onDeleteCalendar,
  proposalBusyId,
  proposalError,
  onCreateProject,
  isCreating = false,
  reasoningEnabled = true,
  onReasoningChange,
  showReasoning = false,
}) {
  return (
    <div className="flex min-h-[calc(100vh-9rem)] min-w-0 flex-col gap-5 xl:flex-row xl:items-stretch">
      <main className="flex min-w-0 flex-1 flex-col gap-5 pr-1">
        <ProjectsOverview
          overview={overview}
          activeProjectId={activeProjectId}
          onSelectProject={onSelectProject}
          isChoosing={isChoosing}
          hasAiChoices={hasAiChoices}
          onChoose={onChoose}
          onCreateProject={onCreateProject}
          isCreating={isCreating}
        />
        {overview?.totals?.projects > 0 && (
          <OverviewUpcoming
            entries={upcomingCalendar}
            onOpenEntry={onOpenCalendarEntry}
            onOpenApproach={onOpenCalendarApproach}
            onDelete={(entry) => onDeleteCalendar?.(entry.id, entry.projectId)}
          />
        )}
      </main>
      {overview?.totals?.projects > 0 && (
        <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-96">
          <OverviewFeed
            messages={feedMessages}
            proposals={calendarProposals}
            isDiscussing={isDiscussing}
            aiProgress={aiProgress}
            onDiscuss={onDiscuss}
            onNewChat={onNewChat}
            onApplyProposal={onApplyProposal}
            onDismissProposal={onDismissProposal}
            proposalBusyId={proposalBusyId}
            proposalError={proposalError}
            reasoningEnabled={reasoningEnabled}
            onReasoningChange={onReasoningChange}
            showReasoning={showReasoning}
          />
        </aside>
      )}
    </div>
  );
}
