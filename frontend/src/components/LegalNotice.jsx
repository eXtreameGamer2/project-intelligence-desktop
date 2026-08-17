import { Link } from 'react-router-dom';
import { LEGAL_DOCUMENTS, getLegalDocument, isLocalProduct, legalMeta } from '../lib/legal';

export function LegalDocumentView({ kind }) {
  const doc = getLegalDocument(kind);

  return (
    <article className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-white">{doc.title}</h3>
        <p className="mt-1 text-xs text-slate-500">
          {doc.productName} · Effective {doc.effectiveDate}
        </p>
      </div>
      {doc.sections.map((section) => (
        <section key={section.heading} className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-200">{section.heading}</h4>
          {section.paragraphs.map((paragraph, index) => (
            <p key={`${section.heading}-${index}`} className="text-sm leading-6 text-slate-400">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}

export function LegalFooterLinks({ className = '' }) {
  const terms = getLegalDocument('terms');
  const privacy = getLegalDocument('privacy');

  return (
    <p className={`text-xs leading-5 text-slate-500 ${className}`}>
      <Link to={terms.path} className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">
        {terms.title}
      </Link>
      <span className="px-1.5 text-slate-600">·</span>
      <Link to={privacy.path} className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">
        {privacy.title}
      </Link>
    </p>
  );
}

export default function LegalNotice() {
  const meta = legalMeta();

  return (
    <div className="panel space-y-8 p-6">
      <div>
        <h3 className="text-base font-semibold text-white">Legal</h3>
        <p className="mt-1 text-sm text-slate-400">
          These notices describe {meta.name}. They are also at{' '}
          <Link to="/terms" className="text-slate-300 underline-offset-2 hover:underline">
            /terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className="text-slate-300 underline-offset-2 hover:underline">
            /privacy
          </Link>
          {isLocalProduct() ? '.' : ', including before you create an account.'}
        </p>
      </div>
      {LEGAL_DOCUMENTS.map((doc) => (
        <LegalDocumentView key={doc.kind} kind={doc.kind} />
      ))}
    </div>
  );
}
