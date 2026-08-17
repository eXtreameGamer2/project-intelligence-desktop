import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchPublicRoadmap } from '../api/client';
import InsightCharts from '../components/InsightCharts';
import { priorityBadgeClass, priorityDisplayLabel } from '../lib/projectInsights';

export default function RoadmapPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchPublicRoadmap(token)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [token]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950">
        <p className="text-sm text-slate-400">Loading public roadmap…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-950 p-4">
        <div className="panel max-w-lg p-8 text-center">
          <h1 className="text-xl font-semibold text-white">Roadmap unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{error || 'This link may be invalid or sharing was disabled.'}</p>
          <Link to="/" className="btn-primary mt-6 inline-flex">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const { project, actionItems } = data;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_35%),linear-gradient(180deg,#0b0f17_0%,#0f172a_100%)]">
      <div className="mx-auto max-w-4xl p-4 md:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Public Roadmap
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-white">{project.name}</h1>
          </div>
          <Link to="/" className="btn-secondary">
            Open Dashboard
          </Link>
        </div>

        <div className="mb-6">
          <InsightCharts compact actionItems={actionItems} reports={[]} />
        </div>

        <div className="panel p-6">
          <h2 className="text-lg font-semibold text-white">Prioritized Approaches</h2>
          <ul className="mt-4 space-y-3">
            {actionItems.map((item) => (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-xl border border-slate-800 bg-surface-950/50 px-4 py-3"
              >
                <span
                  className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    item.completed
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {item.completed ? '✓' : '○'}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${priorityBadgeClass(item.priority)}`}>
                      {priorityDisplayLabel(item.priority)}
                    </span>
                    <span
                      className={`font-medium ${
                        item.completed ? 'text-slate-500 line-through' : 'text-slate-100'
                      }`}
                    >
                      {item.title}
                    </span>
                  </div>
                  {item.description && (
                    <p className="mt-1 text-sm text-slate-400">{item.description}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
