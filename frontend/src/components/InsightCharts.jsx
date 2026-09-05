import { memo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { buildProjectInsights } from '../lib/projectInsights';

const tooltipStyle = {
  backgroundColor: '#111827',
  border: '1px solid #1e293b',
  borderRadius: '12px',
  color: '#e2e8f0',
  fontSize: '12px',
};

function wrapLabel(label, maxChars = 18) {
  const text = String(label || '').trim() || 'Untitled';
  if (text.length <= maxChars) return [text];

  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (word.length > maxChars) {
      let chunk = word;
      while (chunk.length > maxChars) {
        lines.push(chunk.slice(0, maxChars));
        chunk = chunk.slice(maxChars);
      }
      current = chunk;
    } else {
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function CategoryTick({ x, y, payload }) {
  const lines = wrapLabel(payload?.value);
  const startDy = -((lines.length - 1) * 6);

  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="end" fill="#94a3b8" fontSize={11}>
        {lines.map((line, index) => (
          <tspan key={`${line}-${index}`} x={0} dy={index === 0 ? startDy : 12}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function StatCard({ label, value, hint }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function ChartCard({ title, subtitle, children, empty }) {
  return (
    <section className="panel p-5">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{subtitle}</p>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
      </div>
      {empty ? (
        <p className="rounded-xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">
          {empty}
        </p>
      ) : (
        <div className="h-64">{children}</div>
      )}
    </section>
  );
}

function HorizontalBars({ data, color }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
        <CartesianGrid stroke="#1e293b" horizontal={false} />
        <XAxis type="number" allowDecimals={false} stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={148}
          stroke="#64748b"
          tick={<CategoryTick />}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="value" radius={[0, 8, 8, 0]} fill={color} isAnimationActive={false}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.fill || color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function InsightCharts({ actionItems, reports, compact = false }) {
  const insights = buildProjectInsights(actionItems, reports);
  const secondChart = insights.showNextSteps
    ? {
        subtitle: 'Next steps',
        title: 'Saved steps still open',
        data: insights.nextSteps,
        empty: null,
        color: '#60a5fa',
      }
    : insights.showSources
      ? {
          subtitle: 'Sources',
          title: 'Open issues by source',
          data: insights.sources,
          empty: null,
          color: '#3b82f6',
        }
      : {
          subtitle: 'Files',
          title: 'Open approaches by file',
          data: insights.leftoverByFile,
          empty: insights.showLeftoverByFile ? null : 'No open approaches to chart yet.',
          color: '#818cf8',
        };

  return (
    <div className="space-y-5">
      <div className={`grid gap-4 ${compact ? 'sm:grid-cols-3' : 'sm:grid-cols-3'}`}>
        <StatCard
          label="Open approaches"
          value={insights.open}
          hint={insights.total ? `${insights.done} already done` : 'None imported yet'}
        />
        <StatCard
          label="High priority left"
          value={insights.openHigh}
          hint="Still unmarked as done"
        />
        <StatCard
          label="Next steps left"
          value={insights.nextOpen}
          hint={insights.nextDone ? `${insights.nextDone} marked complete` : 'Save a suggestion to track steps'}
        />
      </div>

      <div className={`grid gap-5 ${compact ? '' : 'xl:grid-cols-2'}`}>
        <ChartCard
          subtitle="Remaining work"
          title="Open approaches by priority"
          empty={insights.remainingByPriority.length === 0 ? 'No open approaches.' : null}
        >
          <HorizontalBars data={insights.remainingByPriority} />
        </ChartCard>

        {!compact && (
          <ChartCard
            subtitle={secondChart.subtitle}
            title={secondChart.title}
            empty={secondChart.empty}
          >
            <HorizontalBars data={secondChart.data} color={secondChart.color} />
          </ChartCard>
        )}
      </div>
    </div>
  );
}

export default memo(InsightCharts);
