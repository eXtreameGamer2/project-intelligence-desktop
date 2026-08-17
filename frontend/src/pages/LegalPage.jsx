import { Link, useLocation } from 'react-router-dom';
import { LegalDocumentView } from '../components/LegalNotice';
import AlphaChip from '../components/AlphaChip';
import { getLegalDocument, legalMeta } from '../lib/legal';

export default function LegalPage() {
  const location = useLocation();
  const kind = location.pathname.startsWith('/privacy') ? 'privacy' : 'terms';
  const other = getLegalDocument(kind === 'privacy' ? 'terms' : 'privacy');
  const meta = legalMeta();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_35%),linear-gradient(180deg,#0b0f17_0%,#0f172a_100%)]">
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {meta.name}
            </p>
            <AlphaChip />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link to="/" className="btn-secondary">
              Back
            </Link>
            <Link to={other.path} className="btn-secondary">
              {other.title}
            </Link>
          </div>
        </div>
        <div className="panel p-6">
          <LegalDocumentView kind={kind} />
        </div>
      </div>
    </div>
  );
}
