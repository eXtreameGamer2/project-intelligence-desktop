import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

function Sidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  isCreating,
}) {
  const [isNaming, setIsNaming] = useState(false);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [menuStyle, setMenuStyle] = useState({});
  const [busyId, setBusyId] = useState(null);
  const inputRef = useRef(null);
  const renameRef = useRef(null);
  const menuRef = useRef(null);
  const menuButtonRef = useRef(null);

  useEffect(() => {
    if (isNaming) inputRef.current?.focus();
  }, [isNaming]);

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (!menuId) return undefined;
    const place = () => {
      const rect = menuButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 136;
      const height = 76;
      const left = Math.min(rect.left, window.innerWidth - width - 12);
      const below = rect.bottom + 6;
      const top =
        below + height > window.innerHeight - 12
          ? Math.max(12, rect.top - height - 6)
          : below;
      setMenuStyle({
        position: 'fixed',
        top,
        left: Math.max(12, left),
        width,
        zIndex: 80,
      });
    };
    place();
    const onPointer = (event) => {
      if (
        !menuButtonRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setMenuId(null);
      }
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setMenuId(null);
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuId]);

  const closeForm = () => {
    setIsNaming(false);
    setName('');
  };

  const closeRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const closeMenu = () => setMenuId(null);

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isCreating) return;
    try {
      await onCreateProject(trimmed);
      closeForm();
    } catch {
      // Keep the form open so the name can be corrected.
    }
  };

  const submitRename = async (event, projectId) => {
    event.preventDefault();
    event.stopPropagation();
    const trimmed = renameValue.trim();
    if (!trimmed || busyId) return;
    setBusyId(projectId);
    try {
      await onRenameProject(projectId, trimmed);
      closeRename();
    } catch {
      // Keep the form open so the name can be corrected.
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (projectId) => {
    if (busyId) return;
    setBusyId(projectId);
    try {
      await onDeleteProject(projectId);
      setDeletingId(null);
    } catch {
      // Keep the confirm row so the user can retry or cancel.
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className="panel flex w-72 shrink-0 flex-col p-4">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Projects
        </p>
        <h2 className="mt-1 text-lg font-semibold text-white">Containers</h2>
      </div>

      <div className="mb-3">
        {isNaming ? (
          <form onSubmit={submit} className="space-y-2">
            <input
              ref={inputRef}
              className="input-field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name"
              disabled={isCreating}
              maxLength={80}
            />
            <div className="flex gap-2">
              <button type="submit" disabled={isCreating || !name.trim()} className="btn-primary flex-1">
                {isCreating ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={closeForm} disabled={isCreating} className="btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setIsNaming(true)}
            disabled={isCreating}
            className="btn-secondary w-full"
          >
            + New Project
          </button>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto pr-1">
        {projects.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-sm text-slate-500">
            No projects yet. Create one to begin importing feedback.
          </p>
        )}

        {projects.map((project) => {
          const isActive = project.id === activeProjectId;
          const isRenaming = renamingId === project.id;
          const isDeleting = deletingId === project.id;
          const isBusy = busyId === project.id;
          const menuOpen = menuId === project.id;

          return (
            <div
              key={project.id}
              className={`rounded-xl border px-3 py-3 transition ${
                isActive
                  ? 'border-accent-500/60 bg-accent-500/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.25)]'
                  : 'border-slate-800 bg-surface-950/40 hover:border-slate-700 hover:bg-surface-800/60'
              }`}
            >
              {isRenaming ? (
                <form onSubmit={(event) => submitRename(event, project.id)} className="space-y-2">
                  <input
                    ref={renameRef}
                    className="input-field"
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    disabled={isBusy}
                    maxLength={80}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') closeRename();
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={isBusy || !renameValue.trim()}
                      className="btn-primary flex-1 px-2 py-1.5 text-xs"
                    >
                      {isBusy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={closeRename}
                      disabled={isBusy}
                      className="btn-secondary px-2 py-1.5 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onSelectProject(project.id)}
                    className="w-full text-left"
                  >
                    <div className="font-medium text-slate-100">{project.name}</div>
                    <div className="mt-1 flex gap-3 text-xs text-slate-500">
                      <span>{project._count?.uploadedReports ?? 0} reports</span>
                      <span>{project._count?.actionItems ?? 0} tasks</span>
                    </div>
                  </button>
                  {isDeleting ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs leading-5 text-rose-200">
                        Delete this project and its reports, approaches, and calendar items?
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => confirmDelete(project.id)}
                          className="flex-1 rounded-xl border border-rose-500/40 bg-rose-500/15 px-2 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                        >
                          {isBusy ? 'Deleting…' : 'Delete'}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setDeletingId(null)}
                          className="btn-secondary px-2 py-1.5 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <button
                        ref={menuOpen ? menuButtonRef : undefined}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuId(menuOpen ? null : project.id);
                        }}
                        className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-surface-800 hover:text-slate-200"
                      >
                        Manage {menuOpen ? '▴' : '▾'}
                      </button>
                      {menuOpen &&
                        createPortal(
                          <div
                            ref={menuRef}
                            role="menu"
                            style={menuStyle}
                            className="overflow-hidden rounded-xl border border-slate-700 bg-surface-900 py-1 shadow-2xl"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                closeMenu();
                                setDeletingId(null);
                                setRenamingId(project.id);
                                setRenameValue(project.name);
                              }}
                              className="block w-full px-3 py-1.5 text-left text-xs font-medium text-slate-200 transition hover:bg-surface-800"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                closeMenu();
                                closeRename();
                                setDeletingId(project.id);
                              }}
                              className="block w-full px-3 py-1.5 text-left text-xs font-medium text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200"
                            >
                              Delete
                            </button>
                          </div>,
                          document.body
                        )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default memo(Sidebar);
