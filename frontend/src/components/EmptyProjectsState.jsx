import { useState } from 'react';

export default function EmptyProjectsState({
  eyebrow = 'Projects',
  title = 'Create your first project',
  description = 'Projects keep reports, action items, and calendars isolated. Create one to start importing feedback.',
  onCreateProject,
  isCreating = false,
}) {
  const [name, setName] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || isCreating) return;
    await onCreateProject?.(trimmed);
    setName('');
  };

  return (
    <section className="panel flex min-h-[32rem] w-full flex-1 items-center justify-center p-10">
      <div className="w-full max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
        {onCreateProject && (
          <form onSubmit={submit} className="mt-5 space-y-2 text-left">
            <input
              className="input-field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Project name"
              disabled={isCreating}
              maxLength={80}
              autoFocus
            />
            <button
              type="submit"
              disabled={isCreating || !name.trim()}
              className="btn-primary w-full"
            >
              {isCreating ? 'Creating…' : 'Create project'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
