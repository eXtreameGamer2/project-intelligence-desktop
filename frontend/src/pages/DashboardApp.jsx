import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeSavedSuggestions,
  applyCalendarProposal,
  createCalendarEntry,
  createProject,
  deleteActionItem,
  deleteCalendarEntry,
  deleteProject,
  dismissCalendarProposal,
  discussActionItem,
  discussOverviewFeed,
  effectiveMultiPassCount,
  allowsStructuredImport,
  fetchDashboard,
  fetchOverviewFeed,
  fetchProject,
  fetchActionItem,
  fetchProjects,
  generateItemSuggestions,
  hasSavedAiSettings,
  hydrateAiSettings,
  isAiConnectionError,
  isAiUnreachableError,
  isCanceledError,
  loadActiveProjectId,
  loadAiSettings,
  loadAiUnreachable,
  recommendOverviewChoices,
  saveActiveProjectId,
  saveAiSettings,
  saveAiUnreachable,
  completeItemSuggestion,
  saveItemSuggestion,
  shareRoadmap,
  renameProject,
  testAiConnection,
  toggleActionItem,
  unsaveItemSuggestion,
  updateCalendarEntry,
  updateReportNickname,
  uploadReport,
  expandReport,
  deleteReport,
  deleteAiTraining,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import Sidebar from '../components/Sidebar';
import TopBar from '../components/TopBar';
import MainPanel from '../components/MainPanel';
import SettingsView, { settingsHaveUnsavedChanges } from '../components/SettingsView';
import OverviewPage from './OverviewPage';
import AiUnreachableModal from '../components/AiUnreachableModal';
import ImportStatusBanner from '../components/ImportStatusBanner';
import TrainingOffNotice, {
  dismissTrainingOffNotice,
  isTrainingOffNoticeDismissed,
} from '../components/TrainingOffNotice';
import PatchNotesModal from '../components/PatchNotesModal';
import { AppContext } from '../context/AppContext';
import { applyOverviewChoices } from '../lib/overviewChoices';
import { clearProgressClock, estimateFileJobMs, IMPORT_PROGRESS_CLOCK_ID } from '../lib/jobProgress';
import { estimateTrainedFileJobMs, hasTrainedJobSamples, recordLocalJobTiming } from '../lib/jobTiming';
import { reportDisplayName, reportRefreshState } from '../lib/projectInsights';
import { loadImportFocus, saveImportFocus, importFocusReady } from '../lib/importFocus';
import { isStructuredImportName } from '../lib/uploadTypes';
import {
  CURRENT_APP_VERSION,
  markVersionSeen,
  notesSince,
  readLastSeenVersion,
  shouldShowPatchNotes,
} from '../lib/patchNotes';
import {
  checkAppUpdate,
  desktopUpdatesApi,
  downloadAppUpdate,
  installAppUpdate,
} from '../lib/appUpdates';

export default function DashboardApp() {
  const { user, databaseMode, signOut, authConfig } = useAuth();
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [project, setProject] = useState(null);
  const [reports, setReports] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [calendar, setCalendar] = useState([]);
  const [calendarProposals, setCalendarProposals] = useState([]);
  const [overviewProposals, setOverviewProposals] = useState([]);
  const [proposalBusyId, setProposalBusyId] = useState(null);
  const [proposalError, setProposalError] = useState(null);
  const [projectsOverview, setProjectsOverview] = useState(null);
  const [overviewChoices, setOverviewChoices] = useState(null);
  const [isChoosingOverview, setIsChoosingOverview] = useState(false);
  const overviewChoiceKey = useRef('');
  const [overviewFeed, setOverviewFeed] = useState([]);
  const [upcomingCalendar, setUpcomingCalendar] = useState([]);
  const [isOverviewDiscussing, setIsOverviewDiscussing] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [saveAttention, setSaveAttention] = useState(0);
  const [aiSettings, setAiSettings] = useState(() => loadAiSettings(user?.id));
  const [draftSettings, setDraftSettings] = useState(() => loadAiSettings(user?.id));
  const [importFocus, setImportFocus] = useState(() => loadImportFocus(user?.id));
  const [aiProviderSaved, setAiProviderSaved] = useState(() => hasSavedAiSettings(user?.id));
  const [aiUnreachable, setAiUnreachable] = useState(() => loadAiUnreachable(user?.id));
  const [aiUnreachableModal, setAiUnreachableModal] = useState(false);
  const [trainingNoticeDismissed, setTrainingNoticeDismissed] = useState(() =>
    isTrainingOffNoticeDismissed(user?.id)
  );
  const [isLoadingProject, setIsLoadingProject] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const skipProjectFetchId = useRef('');
  const applyingProposalIds = useRef(new Set());
  const feedEpoch = useRef(0);
  const activeProjectIdRef = useRef(null);
  const importAbortRef = useRef(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [importJob, setImportJob] = useState(null);
  const [expandingReportId, setExpandingReportId] = useState(null);
  const [isUpdatingId, setIsUpdatingId] = useState(null);
  const [suggestingId, setSuggestingId] = useState(null);
  const [discussingId, setDiscussingId] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [analyzingSavedId, setAnalyzingSavedId] = useState(null);
  const idleProgress = {
    active: false,
    step: '',
    percent: 0,
    remainingMs: null,
    remainingAt: null,
    startedAt: null,
    trained: false,
    notice: '',
  };
  const [aiProgress, setAiProgress] = useState(idleProgress);
  const [importProgress, setImportProgress] = useState(idleProgress);
  const [isSharing, setIsSharing] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isDeletingTraining, setIsDeletingTraining] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveNotice, setSaveNotice] = useState(null);
  const [shareUrl, setShareUrl] = useState('');
  const [patchNotesOpen, setPatchNotesOpen] = useState(false);
  const [patchNotesHistory, setPatchNotesHistory] = useState(false);
  const [patchNoteEntries, setPatchNoteEntries] = useState([]);
  const [updateStatus, setUpdateStatus] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const appVersion = authConfig?.appVersion || CURRENT_APP_VERSION;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [focusCalendar, setFocusCalendar] = useState(null);
  const [focusApproach, setFocusApproach] = useState(null);

  const applyProjectPayload = useCallback((data) => {
    if (data.projects) setProjects(data.projects);
    if (data.overview) setProjectsOverview(data.overview);
    if (data.upcomingCalendar) setUpcomingCalendar(data.upcomingCalendar);
    if (data.project) {
      setProject(data.project);
      setReports(data.reports || []);
      setCalendar(data.calendar || []);
      setCalendarProposals(data.calendarProposals || []);
      setActionItems((current) => {
        const incoming = data.actionItems || [];
        const loaded = new Map(
          current.filter((item) => item.threadLoaded).map((item) => [item.id, item])
        );
        if (loaded.size === 0) return incoming;
        return incoming.map((item) => {
          const open = loaded.get(item.id);
          if (!open || item.threadLoaded) return item;
          return {
            ...item,
            discussion: open.discussion,
            suggestionAnalyses: open.suggestionAnalyses,
            suggestions: open.suggestions?.length ? open.suggestions : item.suggestions,
            threadLoaded: true,
          };
        });
      });
      setActiveProjectId(data.project.id);
      saveActiveProjectId(user?.id, data.project.id);
    } else if (data.projects && data.projects.length === 0) {
      setProject(null);
      setReports([]);
      setActionItems([]);
      setCalendar([]);
      setCalendarProposals([]);
      setUpcomingCalendar([]);
      setActiveProjectId(null);
      setProjectsOverview(null);
      saveActiveProjectId(user?.id, '');
    }
  }, [user?.id]);

  const refreshProjects = useCallback(async () => {
    if (!user) return [];
    const data = await fetchProjects(user);
    setProjects(data.projects);
    if (data.overview) setProjectsOverview(data.overview);
    else if (!data.projects?.length) setProjectsOverview(null);
    if (data.upcomingCalendar) setUpcomingCalendar(data.upcomingCalendar);
    else if (!data.projects?.length) setUpcomingCalendar([]);
    return data.projects;
  }, [user]);

  const loadProject = useCallback(
    async (projectId, { silent = false } = {}) => {
      if (!projectId || !user) return;

      if (!silent) setIsLoadingProject(true);
      setError('');
      setShareUrl('');

      try {
        const data = await fetchProject(user, projectId);
        applyProjectPayload(data);
      } catch (err) {
        setError(err.message);
        if (!silent) {
          setProject(null);
          setReports([]);
          setActionItems([]);
        }
      } finally {
        if (!silent) setIsLoadingProject(false);
      }
    },
    [user, applyProjectPayload]
  );

  useEffect(() => {
    if (!user) {
      setIsBootstrapping(false);
      return undefined;
    }

    let cancelled = false;
    setIsBootstrapping(true);
    setError('');

    fetchDashboard(user, loadActiveProjectId(user.id))
      .then((data) => {
        if (cancelled) return;
        if (data.project?.id) skipProjectFetchId.current = data.project.id;
        applyProjectPayload(data);
        if (!data.project && data.projects?.[0]?.id) {
          setActiveProjectId(data.projects[0].id);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setIsBootstrapping(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, applyProjectPayload]);

  useEffect(() => {
    const version = authConfig?.appVersion || CURRENT_APP_VERSION;
    if (!shouldShowPatchNotes(version)) return;
    setPatchNoteEntries(notesSince(readLastSeenVersion(), version));
    setPatchNotesHistory(false);
    setPatchNotesOpen(true);
  }, [authConfig?.appVersion]);

  useEffect(() => {
    const desktop = desktopUpdatesApi();
    if (!desktop?.onStatus) return undefined;
    return desktop.onStatus((payload) => {
      if (payload) setUpdateStatus(payload);
    });
  }, []);

  useEffect(() => {
    if (isBootstrapping) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setUpdateBusy(true);
      checkAppUpdate(appVersion)
        .then((payload) => {
          if (!cancelled && payload) setUpdateStatus(payload);
        })
        .catch(() => { })
        .finally(() => {
          if (!cancelled) setUpdateBusy(false);
        });
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isBootstrapping, appVersion]);

  useEffect(() => {
    let cancelled = false;
    const publicSettings = loadAiSettings(user?.id);
    setAiSettings(publicSettings);
    setDraftSettings(publicSettings);
    setImportFocus(loadImportFocus(user?.id));

    hydrateAiSettings(user?.id)
      .then((hydrated) => {
        if (cancelled) return;
        setAiSettings(hydrated);
        setDraftSettings(hydrated);
        setAiProviderSaved(hasSavedAiSettings(user?.id));
        setAiUnreachable(loadAiUnreachable(user?.id));
      })
      .catch(() => {
        if (cancelled) return;
        setAiSettings(publicSettings);
        setDraftSettings(publicSettings);
        setAiProviderSaved(hasSavedAiSettings(user?.id));
        setAiUnreachable(loadAiUnreachable(user?.id));
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    setTrainingNoticeDismissed(isTrainingOffNoticeDismissed(user?.id));
  }, [user?.id]);

  useEffect(() => {
    if (!activeProjectId || !user || isBootstrapping) return;
    if (skipProjectFetchId.current === activeProjectId) {
      skipProjectFetchId.current = '';
      return;
    }
    if (project?.id === activeProjectId) return;
    loadProject(activeProjectId, { silent: Boolean(project) });
  }, [activeProjectId, user, loadProject, isBootstrapping, project?.id]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    if (activeView !== 'dashboard') return undefined;
    const frame = window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeView]);

  useEffect(() => {
    if (!user) return undefined;

    let cancelled = false;
    setOverviewFeed([]);
    const epoch = feedEpoch.current;
    fetchOverviewFeed(user)
      .then((data) => {
        if (!cancelled && epoch === feedEpoch.current) {
          setOverviewProposals(data.proposals || []);
          if (data.upcomingCalendar) setUpcomingCalendar(data.upcomingCalendar);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!focusCalendar) return;
    if (project?.id !== focusCalendar.projectId) return;
    if (isLoadingProject) return;
    if (!calendar.some((entry) => entry.id === focusCalendar.id)) {
      setFocusCalendar(null);
    }
  }, [focusCalendar, project?.id, isLoadingProject, calendar]);

  useEffect(() => {
    if (!focusApproach) return;
    if (project?.id !== focusApproach.projectId) return;
    if (isLoadingProject) return;
    if (!actionItems.some((item) => item.id === focusApproach.id)) {
      setFocusApproach(null);
    }
  }, [focusApproach, project?.id, isLoadingProject, actionItems]);

  const settingsDirty = settingsHaveUnsavedChanges(draftSettings, aiSettings);
  const settingsDirtyRef = useRef(false);
  const activeViewRef = useRef(activeView);
  settingsDirtyRef.current = settingsDirty;
  activeViewRef.current = activeView;

  const requestNavigate = useCallback((view) => {
    if (view === activeViewRef.current) return true;
    if (activeViewRef.current === 'settings' && view !== 'settings' && settingsDirtyRef.current) {
      setSaveAttention((count) => count + 1);
      return false;
    }
    setActiveView(view);
    return true;
  }, []);

  const handleSelectProject = (projectId) => {
    if (!requestNavigate('dashboard')) return;
    setFocusCalendar(null);
    setFocusApproach(null);
    if (projectId === activeProjectId) {
      return;
    }
    setShareUrl('');
    setError('');
    setActiveProjectId(projectId);
    saveActiveProjectId(user?.id, projectId);
  };

  const handleOpenCalendarEntry = (entry) => {
    if (!entry?.id || !entry.projectId) return;
    handleSelectProject(entry.projectId);
    setFocusCalendar({ id: entry.id, projectId: entry.projectId });
  };

  const handleOpenCalendarApproach = (entry) => {
    if (!entry?.itemId || !entry.projectId) return;
    handleSelectProject(entry.projectId);
    setFocusApproach({ id: entry.itemId, projectId: entry.projectId });
  };

  const handleCreateProject = async (name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || !user) return;
    if (!requestNavigate('dashboard')) return;

    setIsCreatingProject(true);
    setError('');

    try {
      const { project: created } = await createProject(user, trimmed);
      skipProjectFetchId.current = created.id;
      saveActiveProjectId(user.id, created.id);
      setActiveProjectId(created.id);
      await Promise.all([refreshProjects(), loadProject(created.id)]);
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleRenameProject = async (projectId, name) => {
    const trimmed = String(name || '').trim();
    if (!trimmed || !user || !projectId) return;

    setError('');
    try {
      const { project: updated } = await renameProject(user, projectId, trimmed);
      setProjects((current) =>
        current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row))
      );
      setProject((current) =>
        current?.id === updated.id ? { ...current, name: updated.name } : current
      );
      await refreshProjects();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!user || !projectId) return;

    setError('');
    try {
      await deleteProject(user, projectId);
      setUpcomingCalendar((current) => current.filter((entry) => entry.projectId !== projectId));
      setCalendar((current) => current.filter((entry) => entry.projectId !== projectId));
      setCalendarProposals((current) =>
        current.filter((entry) => entry.projectId !== projectId)
      );
      const remaining = await refreshProjects();
      if (activeProjectId !== projectId) return;

      const next = remaining[0];
      if (next) {
        handleSelectProject(next.id);
        return;
      }

      setActiveProjectId(null);
      setProject(null);
      setReports([]);
      setActionItems([]);
      setCalendar([]);
      setCalendarProposals([]);
      setProjectsOverview(null);
      setUpcomingCalendar([]);
      saveActiveProjectId(user.id, '');
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const onProviderModel = useRef(() => { });

  const applyProgressEvent = (setter) => (event) => {
    if (event?.model) onProviderModel.current(event.model);
    const now = Date.now();
    setter((prev) => {
      const remainingMs =
        event?.remainingMs == null
          ? prev.remainingMs ?? estimateFileJobMs(0)
          : Number(event.remainingMs);
      const nextPercent = event?.percent == null ? prev.percent || 0 : Number(event.percent) || 0;
      return {
        active: true,
        step: event?.step || prev.step || 'Working',
        percent: Math.max(prev.percent || 0, nextPercent),
        remainingMs,
        remainingAt: prev.remainingAt || now,
        startedAt: prev.startedAt || now,
        trained: Boolean(event?.trained) || Boolean(prev.trained),
        notice: event?.notice == null ? prev.notice || '' : String(event.notice),
      };
    });
  };

  const trackAiProgress = applyProgressEvent(setAiProgress);
  const trackImportProgress = applyProgressEvent(setImportProgress);

  const resetAiProgress = () => {
    setAiProgress(idleProgress);
  };

  const resetImportProgress = () => {
    clearProgressClock(IMPORT_PROGRESS_CLOCK_ID);
    setImportProgress(idleProgress);
    setImportJob(null);
  };

  const markAiUnreachable = useCallback(
    (unreachable) => {
      setAiUnreachable(saveAiUnreachable(user?.id, unreachable));
    },
    [user?.id]
  );

  const noteAiReachability = useCallback(
    (message, { connected = false, code } = {}) => {
      if (connected) {
        markAiUnreachable(false);
        return;
      }
      if (isAiUnreachableError(message, code)) {
        markAiUnreachable(true);
      }
    },
    [markAiUnreachable]
  );

  const showUnreachablePopup = useCallback(
    (error) => {
      const source = error?.source || error?.analysisSource;
      const message = error?.message || error?.warning || error?.analysisWarning || '';
      const code = error?.code;
      if (source !== 'heuristic' && !isAiUnreachableError(message, code)) return false;
      noteAiReachability(message, { code: code || 'AI_UNREACHABLE' });
      setAiUnreachableModal(true);
      return true;
    },
    [noteAiReachability]
  );

  const overviewDataKey = useMemo(
    () =>
      (projectsOverview?.projects || [])
        .map((row) => `${row.id}:${row.open}:${row.openHigh}:${row.nextOpen}:${row.staleDays || 0}`)
        .join('|'),
    [projectsOverview]
  );

  useEffect(() => {
    if (!overviewChoices) return;
    if (overviewChoiceKey.current && overviewChoiceKey.current !== overviewDataKey) {
      setOverviewChoices(null);
      overviewChoiceKey.current = '';
    }
  }, [overviewDataKey, overviewChoices]);

  const handleOverviewChoose = async () => {
    if (!user || !projectsOverview?.projects?.length || isChoosingOverview) return;

    setError('');
    setIsChoosingOverview(true);
    try {
      const result = await recommendOverviewChoices(user, aiSettings);
      if (showUnreachablePopup({ message: result.warning, source: result.source })) {
        return;
      }
      setOverviewChoices(result.choices || null);
      overviewChoiceKey.current = overviewDataKey;
      noteAiReachability('', { connected: true });
    } catch (err) {
      if (isAiConnectionError(err.message, err.code)) {
        showUnreachablePopup(err);
      } else {
        setError(err.message);
      }
    } finally {
      setIsChoosingOverview(false);
    }
  };

  const handleUpload = async (file) => {
    const projectId = activeProjectId;
    const projectName =
      (project?.id === projectId && project?.name) ||
      projects.find((item) => item.id === projectId)?.name ||
      'Project';
    if (!user || !projectId || isUploading || expandingReportId || !importFocusReady(importFocus)) return;
    if (isStructuredImportName(file.name) && !allowsStructuredImport(aiSettings)) {
      setError(
        'CSV, Excel, ODS, JSON, and HTML need multi-pass import with 4 to 8 passes. Turn that on in Settings, or upload Word, PDF, PowerPoint, or text instead.'
      );
      return;
    }

    const controller = new AbortController();
    importAbortRef.current = controller;
    setImportJob({
      projectId,
      projectName,
      fileName: file.name,
    });
    setIsUploading(true);
    setError('');
    setNotice('');
    const importStartedAt = Date.now();
    trackImportProgress({
      step: effectiveMultiPassCount(aiSettings) > 1 ? 'Saving' : 'Reading',
      percent: 4,
      remainingMs: estimateTrainedFileJobMs(file.size, effectiveMultiPassCount(aiSettings), {
        userId: user?.id,
        trainingOn: Boolean(aiSettings.localTrainingEnabled),
      }),
      trained:
        Boolean(aiSettings.localTrainingEnabled) && hasTrainedJobSamples(user?.id, 'import'),
    });

    try {
      const result = await uploadReport(
        user,
        projectId,
        file,
        aiSettings,
        trackImportProgress,
        importFocus,
        controller.signal
      );
      if (
        showUnreachablePopup({
          message: result.analysisWarning,
          analysisSource: result.analysisSource,
        })
      ) {
        return;
      }
      noteAiReachability('', { connected: true });
      await Promise.all([
        activeProjectIdRef.current === projectId
          ? loadProject(projectId, { silent: true })
          : Promise.resolve(),
        refreshProjects(),
      ]);
      if (result.duplicate) {
        setNotice(result.message);
      } else if (activeProjectIdRef.current !== projectId) {
        setNotice(`Finished importing ${file.name} into ${projectName}. Open that project to see the new file.`);
      } else if (!result.actionItems?.length && result.message) {
        setNotice(result.message);
      }
      if (aiSettings.localTrainingEnabled) {
        recordLocalJobTiming(user.id, {
          job: 'import',
          fileBytes: file.size,
          passCount: effectiveMultiPassCount(aiSettings),
          elapsedMs: Date.now() - importStartedAt,
        });
      }
    } catch (err) {
      if (isCanceledError(err)) {
        setNotice('Import canceled.');
      } else if (!showUnreachablePopup(err)) {
        setError(err.message);
      }
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
      setIsUploading(false);
      resetImportProgress();
    }
  };

  const handleExpandReport = async (report) => {
    const projectId = activeProjectId;
    if (!user || !projectId || !report?.id || isUploading || expandingReportId) return;

    const refresh = reportRefreshState(
      actionItems.filter((item) => item.reportId === report.id)
    );
    if (!refresh.canRefresh) {
      setError('Complete every approach on this file before refreshing findings.');
      return;
    }

    const controller = new AbortController();
    importAbortRef.current = controller;
    setExpandingReportId(report.id);
    setImportJob({
      projectId,
      projectName: project?.name || 'Project',
      fileName: reportDisplayName(report),
    });
    setError('');
    setNotice('');
    const expandStartedAt = Date.now();
    trackImportProgress({
      step: 'Expanding',
      percent: 4,
      remainingMs: estimateTrainedFileJobMs(report.fileSize || 0, 1, {
        userId: user?.id,
        trainingOn: Boolean(aiSettings.localTrainingEnabled),
      }),
      trained:
        Boolean(aiSettings.localTrainingEnabled) && hasTrainedJobSamples(user?.id, 'import'),
    });

    try {
      const result = await expandReport(
        user,
        projectId,
        report.id,
        aiSettings,
        trackImportProgress,
        importFocus,
        controller.signal
      );
      if (
        showUnreachablePopup({
          message: result.analysisWarning,
          analysisSource: result.analysisSource,
        })
      ) {
        return;
      }
      noteAiReachability('', { connected: true });
      await Promise.all([
        activeProjectIdRef.current === projectId
          ? loadProject(projectId, { silent: true })
          : Promise.resolve(),
        refreshProjects(),
      ]);
      if (result.message) setNotice(result.message);
      if (aiSettings.localTrainingEnabled) {
        recordLocalJobTiming(user.id, {
          job: 'import',
          fileBytes: report.fileSize || 0,
          passCount: 1,
          elapsedMs: Date.now() - expandStartedAt,
        });
      }
    } catch (err) {
      if (isCanceledError(err)) {
        setNotice('Import canceled.');
      } else if (!showUnreachablePopup(err)) {
        setError(err.message);
      }
    } finally {
      if (importAbortRef.current === controller) importAbortRef.current = null;
      setExpandingReportId(null);
      resetImportProgress();
    }
  };

  const replaceActionItem = (actionItem) => {
    setActionItems((prev) =>
      prev.map((entry) => (entry.id === actionItem.id ? actionItem : entry))
    );
  };

  const handleHydrateItem = async (itemId) => {
    if (!user || !activeProjectId || !itemId) return;
    const current = actionItems.find((entry) => entry.id === itemId);
    if (current?.threadLoaded) return;
    try {
      const { actionItem } = await fetchActionItem(user, activeProjectId, itemId);
      replaceActionItem(actionItem);
    } catch (err) {
      if (!showUnreachablePopup(err)) {
        setError(err.message);
      }
    }
  };

  const handleCancelImport = () => {
    importAbortRef.current?.abort();
  };

  const handleToggleItem = async (item) => {
    if (!user || !activeProjectId) return;

    setIsUpdatingId(item.id);
    try {
      const { actionItem } = await toggleActionItem(
        user,
        activeProjectId,
        item.id,
        !item.completed
      );
      replaceActionItem(actionItem);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUpdatingId(null);
    }
  };

  const removeActionItemsLocally = (itemIds) => {
    const removed = new Set((itemIds || []).filter(Boolean));
    if (!removed.size) return;
    const titles = new Set(
      actionItems
        .filter((item) => removed.has(item.id))
        .map((item) => String(item.title || '').trim())
        .filter(Boolean)
    );
    const keepEntry = (entry) => {
      if (removed.has(entry.itemId)) return false;
      if (!entry.itemId && titles.has(String(entry.title || '').trim())) return false;
      return true;
    };
    setActionItems((current) => current.filter((item) => !removed.has(item.id)));
    setCalendarProposals((current) =>
      current.filter((proposal) => !proposal.itemId || !removed.has(proposal.itemId))
    );
    setCalendar((current) => current.filter(keepEntry));
    setUpcomingCalendar((current) => current.filter(keepEntry));
    setFocusApproach((current) => (current && removed.has(current.id) ? null : current));
  };

  const handleDeleteItem = async (item) => {
    if (!user || !activeProjectId || !item?.id) return;

    setIsUpdatingId(item.id);
    setError('');
    try {
      const result = await deleteActionItem(user, activeProjectId, item.id);
      removeActionItemsLocally(result.deletedItemIds || [item.id]);
      await refreshProjects();
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsUpdatingId(null);
    }
  };

  const handleRenameReport = async (report, nickname) => {
    if (!user || !activeProjectId || !report?.id) return;

    setError('');
    try {
      const { report: updated } = await updateReportNickname(
        user,
        activeProjectId,
        report.id,
        nickname
      );
      setReports((current) =>
        current.map((entry) =>
          entry.id === updated.id ? { ...entry, nickname: updated.nickname } : entry
        )
      );
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteReport = async (report) => {
    if (!user || !activeProjectId || !report?.id) return;

    const removedItemIds = actionItems
      .filter((item) => item.reportId === report.id)
      .map((item) => item.id);

    setError('');
    try {
      await deleteReport(user, activeProjectId, report.id);
      setReports((current) => current.filter((entry) => entry.id !== report.id));
      removeActionItemsLocally(removedItemIds);
      await refreshProjects();
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleLoadSuggestions = async (item) => {
    if (!user || !activeProjectId || item.suggestions?.length || aiUnreachable) return;

    setSuggestingId(item.id);
    trackAiProgress({ step: 'Reading', percent: 4 });
    try {
      const result = await generateItemSuggestions(
        user,
        activeProjectId,
        item.id,
        aiSettings,
        trackAiProgress
      );
      if (showUnreachablePopup({ message: result.warning, source: result.source })) {
        return;
      }
      replaceActionItem(result.actionItem);
      noteAiReachability('', { connected: true });
    } catch (err) {
      if (!showUnreachablePopup(err)) {
        setError(err.message);
      }
    } finally {
      setSuggestingId(null);
      resetAiProgress();
    }
  };

  const handleSaveSuggestion = async (item, suggestion) => {
    if (!user || !activeProjectId) return;

    setSavingKey(`${item.id}:${suggestion.title}`);
    setError('');
    try {
      const { actionItem } = await saveItemSuggestion(
        user,
        activeProjectId,
        item.id,
        suggestion
      );
      replaceActionItem(actionItem);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const handleCompleteSuggestion = async (item, suggestion, completed = true) => {
    if (!user || !activeProjectId) return;

    setSavingKey(`${item.id}:${suggestion.title}`);
    setError('');
    try {
      const { actionItem } = await completeItemSuggestion(
        user,
        activeProjectId,
        item.id,
        suggestion,
        completed
      );
      replaceActionItem(actionItem);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const handleUnsaveSuggestion = async (item, suggestion) => {
    if (!user || !activeProjectId || !suggestion.savedId) return;

    setSavingKey(`${item.id}:${suggestion.title}`);
    setError('');
    try {
      const { actionItem } = await unsaveItemSuggestion(
        user,
        activeProjectId,
        item.id,
        suggestion.savedId
      );
      replaceActionItem(actionItem);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  };

  const applySuggestionAnalysis = (result) => {
    if (showUnreachablePopup({ message: result.warning, source: result.source })) {
      return;
    }
    if (result.actionItems) {
      setActionItems(result.actionItems);
    }
    if (result.source === 'ai') {
      noteAiReachability('', { connected: true });
    }
  };

  const handleAnalyzeItemFile = async (item, file, suggestion, linkedSavedIds = []) => {
    if (!user || !activeProjectId || !suggestion?.savedId) return;

    setAnalyzingSavedId(suggestion.savedId);
    setError('');
    setNotice('');
    trackAiProgress({
      step: 'Reading',
      percent: 4,
      remainingMs: estimateFileJobMs(file.size),
    });
    try {
      const result = await analyzeSavedSuggestions(
        user,
        activeProjectId,
        file,
        aiSettings,
        item.id,
        suggestion.savedId,
        trackAiProgress,
        linkedSavedIds
      );
      applySuggestionAnalysis(result);
    } catch (err) {
      if (!showUnreachablePopup(err)) {
        setError(err.message);
      }
    } finally {
      setAnalyzingSavedId(null);
      resetAiProgress();
    }
  };

  const handleOverviewDiscuss = async (message) => {
    if (!user) return;
    const epoch = feedEpoch.current;

    setIsOverviewDiscussing(true);
    setError('');
    trackAiProgress({ step: 'Reading', percent: 4 });

    // ADD: Add user message immediately
    const userMsg = { id: Date.now(), role: 'user', content: message };
    setOverviewFeed(prev => [...prev, userMsg]);

    // ADD: Add placeholder assistant message
    const assistantId = Date.now() + 1;
    setOverviewFeed(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }]);

    try {
      // MODIFY: Add onContent parameter (7th argument)
      const result = await discussOverviewFeed(
        user,
        message,
        aiSettings,
        trackAiProgress,
        overviewChoices,
        overviewFeed,
        // 👇 NEW: onContent callback for streaming chunks
        (chunk) => {
          if (epoch !== feedEpoch.current) return; // Don't update if new chat started
          const delta = chunk.content || chunk.delta || chunk.text || '';
          if (!delta) return;
          setOverviewFeed(prev =>
            prev.map(msg =>
              msg.id === assistantId
                ? { ...msg, content: msg.content + delta }
                : msg
            )
          );
        }
      );

      if (showUnreachablePopup({ message: result.warning, source: result.source })) {
        return;
      }

      // IMPORTANT: Skip setting messages if they were already streamed
      if (epoch === feedEpoch.current && result.messages) {
        // Only add messages that aren't already in the feed
        setOverviewFeed(prev => {
          const existingIds = new Set(prev.map(m => m.id));
          const newMessages = result.messages.filter(m => !existingIds.has(m.id) && m.role !== 'user');
          return [...prev, ...newMessages];
        });
      }

      // Keep everything else exactly the same
      setOverviewProposals(result.proposals || []);
      if (result.upcomingCalendar) setUpcomingCalendar(result.upcomingCalendar);
      (result.entries || []).forEach((entry) => upsertCalendarEntry(entry));
      if (result.deletedItemIds?.length) {
        removeActionItemsLocally(result.deletedItemIds);
        await refreshProjects();
      }
      if (Array.isArray(result.proposals)) {
        const incomingIds = new Set(result.proposals.map((entry) => entry.id));
        setCalendarProposals((current) => {
          const withoutOverview = current.filter((entry) => entry.source !== 'overview');
          const incoming = result.proposals.filter(
            (entry) => !activeProjectId || entry.projectId === activeProjectId
          );
          return [...incoming, ...withoutOverview.filter((entry) => !incomingIds.has(entry.id))];
        });
      }
      noteAiReachability('', { connected: true });

    } catch (err) {
      // ADD: Show error in the assistant message
      if (epoch === feedEpoch.current) {
        setOverviewFeed(prev =>
          prev.map(msg =>
            msg.id === assistantId
              ? { ...msg, content: '⚠️ Error: ' + err.message }
              : msg
          )
        );
      }
      if (!showUnreachablePopup(err)) {
        setError(err.message);
      }
    } finally {
      setIsOverviewDiscussing(false);
      resetAiProgress();
    }
  };

  const handleOverviewNewChat = () => {
    feedEpoch.current += 1;
    setOverviewFeed([]);
  };

  const handleDiscuss = async (item, message) => {
    if (!user || !activeProjectId) return;

    setDiscussingId(item.id);
    setError('');
    trackAiProgress({ step: 'Reading', percent: 4 });
    try {
      const result = await discussActionItem(
        user,
        activeProjectId,
        item.id,
        message,
        aiSettings,
        trackAiProgress
      );
      if (showUnreachablePopup({ message: result.warning, source: result.source })) {
        return;
      }
      if (result.deletedItemIds?.length) {
        removeActionItemsLocally(result.deletedItemIds);
        await refreshProjects();
        if (result.deletedItemIds.includes(item.id)) {
          noteAiReachability('', { connected: true });
          return;
        }
      }
      if (result.actionItem) replaceActionItem(result.actionItem);
      if (Array.isArray(result.proposals)) {
        setCalendarProposals((current) => {
          const incoming = result.proposals;
          const ids = new Set(incoming.map((entry) => entry.id));
          return [
            ...incoming,
            ...current.filter((entry) => entry.itemId !== item.id && !ids.has(entry.id)),
          ];
        });
      }
      (result.entries || []).forEach((entry) => upsertCalendarEntry(entry));
      if (result.entry) upsertCalendarEntry(result.entry);
      if (result.upcomingCalendar) setUpcomingCalendar(result.upcomingCalendar);
      noteAiReachability('', { connected: true });
    } catch (err) {
      if (!showUnreachablePopup(err)) {
        setError(err.message);
      }
    } finally {
      setDiscussingId(null);
      resetAiProgress();
    }
  };

  const handleCreateCalendar = async (payload) => {
    if (!user || !activeProjectId) return;
    try {
      const result = await createCalendarEntry(user, activeProjectId, payload);
      upsertCalendarEntry({ ...result.entry, projectId: activeProjectId, projectName: project?.name });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUpdateCalendar = async (entryId, payload) => {
    if (!user || !activeProjectId) return;
    const result = await updateCalendarEntry(user, activeProjectId, entryId, payload);
    upsertCalendarEntry({ ...result.entry, projectId: activeProjectId, projectName: project?.name });
  };

  const handleDeleteCalendar = async (entryId, projectId = activeProjectId) => {
    if (!user || !projectId) return;
    try {
      await deleteCalendarEntry(user, projectId, entryId);
      setCalendar((current) => current.filter((entry) => entry.id !== entryId));
      setUpcomingCalendar((current) => current.filter((entry) => entry.id !== entryId));
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const upsertCalendarEntry = (entry) => {
    if (!entry) return;
    setCalendar((current) => {
      if (entry.projectId && activeProjectId && entry.projectId !== activeProjectId) {
        return current;
      }
      const without = current.filter((row) => row.id !== entry.id);
      return [...without, entry].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    });
    setUpcomingCalendar((current) => {
      const without = current.filter((row) => row.id !== entry.id);
      if ((entry.displayStatus || entry.status) === 'completed') return without;
      return [...without, entry].sort((a, b) => new Date(a.startAt) - new Date(b.startAt)).slice(0, 12);
    });
  };

  const handleApplyProposal = async (proposal) => {
    if (!user) return;
    if (!proposal?.id) {
      setError('That schedule change could not be saved. Ask again, then click Confirm.');
      return;
    }
    if (applyingProposalIds.current.has(proposal.id)) return;
    applyingProposalIds.current.add(proposal.id);
    feedEpoch.current += 1;
    setProposalBusyId(proposal.id);
    setProposalError(null);
    setError('');
    setNotice('');
    setCalendarProposals((current) => current.filter((entry) => entry.id !== proposal.id));
    setOverviewProposals((current) => current.filter((entry) => entry.id !== proposal.id));
    try {
      const result = await applyCalendarProposal(user, proposal.id);
      if (proposal.action !== 'delete' && !result.entry) {
        throw new Error('The calendar item was not created. Click Confirm again.');
      }
      setCalendarProposals((current) => current.filter((entry) => entry.id !== proposal.id));
      setOverviewProposals((current) => current.filter((entry) => entry.id !== proposal.id));
      if (result.upcomingCalendar) setUpcomingCalendar(result.upcomingCalendar);
      if (result.entry) {
        upsertCalendarEntry({
          ...result.entry,
          projectName: result.entry.projectName || proposal.projectName,
        });
      }
      if (result.proposal?.action === 'delete' && proposal.entryId) {
        setCalendar((current) => current.filter((entry) => entry.id !== proposal.entryId));
        setUpcomingCalendar((current) => current.filter((entry) => entry.id !== proposal.entryId));
      }
      const title = result.entry?.title || proposal.payload?.title;
      const savedNote =
        proposal.action === 'delete'
          ? title
            ? `Removed “${title}” from the calendar.`
            : 'That schedule item was removed.'
          : title
            ? `Added “${title}” to the calendar.`
            : 'That schedule change is on the calendar now.';
      setNotice(savedNote);
      if (proposal.source === 'overview' || !proposal.itemId) {
        setOverviewFeed((current) => [
          ...current,
          {
            id: `note-${Date.now()}`,
            role: 'assistant',
            content: savedNote,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      setOverviewProposals((current) =>
        current.some((entry) => entry.id === proposal.id) ? current : [proposal, ...current]
      );
      setCalendarProposals((current) =>
        current.some((entry) => entry.id === proposal.id) ? current : [proposal, ...current]
      );
      setError(err.message);
      setProposalError({ id: proposal.id, message: err.message });
    } finally {
      applyingProposalIds.current.delete(proposal.id);
      setProposalBusyId(null);
    }
  };

  const handleDismissProposal = async (proposal) => {
    if (!user) return;
    setProposalBusyId(proposal.id);
    setProposalError(null);
    try {
      await dismissCalendarProposal(user, proposal.id);
      setCalendarProposals((current) => current.filter((entry) => entry.id !== proposal.id));
      setOverviewProposals((current) => current.filter((entry) => entry.id !== proposal.id));
      if (proposal.source === 'overview' || !proposal.itemId) {
        setOverviewFeed((current) => [
          ...current,
          {
            id: `note-${Date.now()}`,
            role: 'assistant',
            content: 'Okay — I left the calendar as it is.',
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      setError(err.message);
      setProposalError({ id: proposal.id, message: err.message });
    } finally {
      setProposalBusyId(null);
    }
  };

  const handleShareRoadmap = async () => {
    if (!user || !activeProjectId) {
      setError('Select a project before sharing its roadmap.');
      return;
    }

    setIsSharing(true);
    setError('');

    try {
      const result = await shareRoadmap(user, activeProjectId);
      const fullUrl = `${window.location.origin}${result.shareUrl}`;
      setShareUrl(fullUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSharing(false);
    }
  };

  const handleReasoningChange = (enabled) => {
    const next = { ...aiSettings, reasoningEnabled: Boolean(enabled) };
    setAiSettings(next);
    setDraftSettings((current) => ({ ...current, reasoningEnabled: Boolean(enabled) }));
    saveAiSettings(next, user?.id).catch(() => { });
  };

  const handleSaveSettings = async () => {
    try {
      const saved = await saveAiSettings(draftSettings, user?.id);
      setDraftSettings(saved);
      setAiSettings(saved);
      setAiProviderSaved(true);
      setSaveNotice({
        ok: true,
        message: saved.hasApiKey
          ? 'Settings saved. API keys are stored encrypted.'
          : 'Settings saved.',
      });
    } catch (err) {
      setSaveNotice({ ok: false, message: err.message });
    }
  };

  const handleRemoveApiKey = async () => {
    try {
      const saved = await saveAiSettings(
        { ...draftSettings, apiKey: '', clearApiKey: true },
        user?.id
      );
      setDraftSettings(saved);
      setAiSettings(saved);
      setAiProviderSaved(true);
      setSaveNotice({ ok: true, message: 'Saved API key removed.' });
    } catch (err) {
      setSaveNotice({ ok: false, message: err.message });
    }
  };

  const handleDeleteTraining = async () => {
    if (!user || isDeletingTraining) return { deleted: 0 };
    setIsDeletingTraining(true);
    try {
      return await deleteAiTraining(user);
    } finally {
      setIsDeletingTraining(false);
    }
  };

  const fillDiscoveredModel = (model) => {
    const nextName = String(model || '').trim();
    if (!nextName) return;
    setDraftSettings((current) =>
      current.modelName === nextName ? current : { ...current, modelName: nextName }
    );
    setAiSettings((current) => {
      if (current.modelName === nextName) return current;
      const next = { ...current, modelName: nextName };
      saveAiSettings(next, user?.id)
        .then((saved) => {
          setAiSettings((latest) => ({
            ...latest,
            modelName: nextName,
            hasApiKey: saved.hasApiKey,
          }));
          setAiProviderSaved(true);
        })
        .catch(() => { });
      return next;
    });
  };
  onProviderModel.current = fillDiscoveredModel;

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    trackAiProgress({ step: 'Connecting', percent: 4 });

    try {
      const result = await testAiConnection(draftSettings, (event) => {
        trackAiProgress(event);
        fillDiscoveredModel(event?.model);
      });
      fillDiscoveredModel(result.model);
      noteAiReachability('', { connected: true });
      setTestResult({
        ok: true,
        message: result.updated
          ? `Connected. Model name updated to ${result.model} so it matches this provider.`
          : `Connected. Model: ${result.model}`,
      });
    } catch (err) {
      noteAiReachability(err.message, { code: err.code });
      setTestResult({
        ok: false,
        unreachable: isAiUnreachableError(err.message, err.code),
        message: err.message,
      });
    } finally {
      setIsTesting(false);
      resetAiProgress();
    }
  };

  const openPatchNotes = (history = false) => {
    const version = authConfig?.appVersion || CURRENT_APP_VERSION;
    setPatchNoteEntries(history ? [] : notesSince(readLastSeenVersion(), version));
    setPatchNotesHistory(Boolean(history));
    setPatchNotesOpen(true);
  };

  const closePatchNotes = () => {
    markVersionSeen(authConfig?.appVersion || CURRENT_APP_VERSION);
    setPatchNotesOpen(false);
  };

  const handleCheckUpdates = async () => {
    setUpdateBusy(true);
    setUpdateStatus((current) => ({ ...(current || {}), state: 'checking', current: appVersion }));
    try {
      const payload = await checkAppUpdate(appVersion);
      if (payload) setUpdateStatus(payload);
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateBusy(true);
    try {
      const payload = await downloadAppUpdate(updateStatus);
      if (payload) setUpdateStatus(payload);
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleInstallUpdate = async () => {
    const payload = await installAppUpdate();
    if (payload) setUpdateStatus(payload);
  };

  const updateAvailable =
    updateStatus?.state === 'available' ||
    (Boolean(updateStatus?.available) &&
      updateStatus?.state !== 'current' &&
      updateStatus?.state !== 'error');
  const updateReady = updateStatus?.state === 'ready';

  const contextValue = useMemo(
    () => ({ user, databaseMode, aiSettings }),
    [user, databaseMode, aiSettings]
  );
  const displayedOverview = useMemo(
    () => applyOverviewChoices(projectsOverview, overviewChoices),
    [projectsOverview, overviewChoices]
  );

  if (isBootstrapping) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950">
        <p className="text-sm text-slate-400">Starting dashboard…</p>
      </div>
    );
  }

  return (
    <AppContext.Provider value={contextValue}>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_35%),linear-gradient(180deg,#0b0f17_0%,#0f172a_100%)]">
        <div className="mx-auto w-full max-w-[1600px] p-4 md:p-6">
          <TopBar
            user={user}
            aiSettings={aiSettings}
            hasSavedAiSettings={aiProviderSaved}
            aiUnreachable={aiUnreachable}
            appVersion={appVersion}
            updateAvailable={updateAvailable && !updateReady}
            updateReady={updateReady}
            activeView={activeView}
            onNavigate={requestNavigate}
            onOpenPatchNotes={() => openPatchNotes(true)}
            onShareRoadmap={handleShareRoadmap}
            onSignOut={authConfig?.enabled ? signOut : undefined}
            isSharing={isSharing}
            shareUrl={shareUrl}
          />

          {error && (
            <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}

          {notice && (
            <div className="mb-4 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-200">
              {notice}
            </div>
          )}

          {!aiSettings.localTrainingEnabled && !trainingNoticeDismissed && activeView !== 'settings' ? (
            <TrainingOffNotice
              onOpenSettings={() => requestNavigate('settings')}
              onDismiss={() => {
                dismissTrainingOffNotice(user?.id);
                setTrainingNoticeDismissed(true);
              }}
            />
          ) : null}

          {importJob ? (
            <div
              className={
                activeView === 'dashboard' && importJob.projectId === activeProjectId
                  ? 'hidden'
                  : undefined
              }
            >
              <ImportStatusBanner
                job={importJob}
                progress={importProgress}
                onOpenProject={() => handleSelectProject(importJob.projectId)}
                onCancel={handleCancelImport}
              />
            </div>
          ) : null}

          {activeView === 'settings' && (
            <SettingsView
              settings={draftSettings}
              onChange={setDraftSettings}
              onSave={handleSaveSettings}
              onRemoveKey={handleRemoveApiKey}
              onTest={handleTestConnection}
              onDeleteTraining={handleDeleteTraining}
              isDeletingTraining={isDeletingTraining}
              testResult={testResult}
              isTesting={isTesting}
              aiProgress={aiProgress}
              serverUnreachable={aiUnreachable}
              unsaved={settingsDirty}
              saveAttention={saveAttention}
              saveNotice={saveNotice}
              appVersion={appVersion}
              onOpenPatchNotes={() => openPatchNotes(true)}
              updateStatus={updateStatus}
              updateBusy={updateBusy}
              onCheckUpdates={handleCheckUpdates}
              onDownloadUpdate={handleDownloadUpdate}
              onInstallUpdate={handleInstallUpdate}
            />
          )}
          {activeView === 'overview' && (
            <OverviewPage
              overview={displayedOverview}
              activeProjectId={activeProjectId}
              onSelectProject={handleSelectProject}
              onOpenCalendarEntry={handleOpenCalendarEntry}
              onOpenCalendarApproach={handleOpenCalendarApproach}
              isChoosing={isChoosingOverview}
              hasAiChoices={Boolean(overviewChoices)}
              onChoose={handleOverviewChoose}
              feedMessages={overviewFeed}
              calendarProposals={overviewProposals}
              upcomingCalendar={upcomingCalendar}
              isDiscussing={isOverviewDiscussing}
              aiProgress={aiProgress}
              onDiscuss={handleOverviewDiscuss}
              onNewChat={handleOverviewNewChat}
              onApplyProposal={handleApplyProposal}
              onDismissProposal={handleDismissProposal}
              onDeleteCalendar={handleDeleteCalendar}
              proposalBusyId={proposalBusyId}
              proposalError={proposalError}
              onCreateProject={handleCreateProject}
              isCreating={isCreatingProject}
              reasoningEnabled={aiSettings.reasoningEnabled !== false}
              onReasoningChange={handleReasoningChange}
              showReasoning
            />
          )}
          <div
            className={
              activeView === 'dashboard'
                ? 'flex min-h-[calc(100vh-9rem)] items-stretch gap-4'
                : 'hidden'
            }
            inert={activeView !== 'dashboard'}
            aria-hidden={activeView !== 'dashboard'}
          >
            <Sidebar
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={handleSelectProject}
              onCreateProject={handleCreateProject}
              onRenameProject={handleRenameProject}
              onDeleteProject={handleDeleteProject}
              isCreating={isCreatingProject}
            />
            <MainPanel
              project={project}
              reports={reports}
              actionItems={actionItems}
              calendar={calendar}
              calendarProposals={calendarProposals}
              onUpload={handleUpload}
              onToggleItem={handleToggleItem}
              onRenameReport={handleRenameReport}
              onExpandReport={handleExpandReport}
              onDeleteReport={handleDeleteReport}
              onDeleteItem={handleDeleteItem}
              expandingReportId={expandingReportId}
              importFocus={importFocus}
              onImportFocusChange={(next) => setImportFocus(saveImportFocus(user?.id, next))}
              onCancelImport={handleCancelImport}
              onLoadSuggestions={handleLoadSuggestions}
              onDiscuss={handleDiscuss}
              onSaveSuggestion={handleSaveSuggestion}
              onUnsaveSuggestion={handleUnsaveSuggestion}
              onCompleteSuggestion={handleCompleteSuggestion}
              onAnalyzeItemFile={handleAnalyzeItemFile}
              onHydrateItem={handleHydrateItem}
              onCreateCalendar={handleCreateCalendar}
              onUpdateCalendar={handleUpdateCalendar}
              onDeleteCalendar={handleDeleteCalendar}
              focusCalendarId={
                focusCalendar && project && focusCalendar.projectId === project.id
                  ? focusCalendar.id
                  : null
              }
              onCalendarFocused={() => setFocusCalendar(null)}
              focusApproachId={
                focusApproach && project && focusApproach.projectId === project.id
                  ? focusApproach.id
                  : null
              }
              onApproachFocused={() => setFocusApproach(null)}
              onApplyProposal={handleApplyProposal}
              onDismissProposal={handleDismissProposal}
              proposalBusyId={proposalBusyId}
              proposalError={proposalError}
              isUploading={isUploading || Boolean(expandingReportId)}
              isUpdatingId={isUpdatingId}
              suggestingId={suggestingId}
              discussingId={discussingId}
              savingKey={savingKey}
              analyzingSavedId={analyzingSavedId}
              aiProgress={aiProgress}
              importProgress={importProgress}
              isLoading={isLoadingProject}
              multiPass={effectiveMultiPassCount(aiSettings) > 1}
              passCount={effectiveMultiPassCount(aiSettings)}
              hasProjects={projects.length > 0}
              onCreateProject={handleCreateProject}
              isCreating={isCreatingProject}
              reasoningEnabled={aiSettings.reasoningEnabled !== false}
              onReasoningChange={handleReasoningChange}
              showReasoning
            />
          </div>
        </div>

        <PatchNotesModal
          isOpen={patchNotesOpen}
          currentVersion={appVersion}
          newEntries={patchNoteEntries}
          showHistory={patchNotesHistory}
          onClose={closePatchNotes}
        />
        <AiUnreachableModal
          isOpen={aiUnreachableModal}
          onClose={() => setAiUnreachableModal(false)}
          onOpenSettings={() => {
            setAiUnreachableModal(false);
            requestNavigate('settings');
          }}
        />
      </div>
    </AppContext.Provider>
  );
}
