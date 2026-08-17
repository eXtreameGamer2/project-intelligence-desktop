import { createPortal } from 'react-dom';

export default function AiUnreachableModal({ isOpen, onClose, onOpenSettings }) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close modal backdrop"
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="panel relative z-10 w-full max-w-lg overflow-hidden p-0">
        <div className="px-6 pb-2 pt-6">
          <h2 className="text-2xl font-semibold text-white">AI server unreachable</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-300">
            The local AI could not be reached, so this request was not completed. Verify the
            port in Local AI settings, then Test Connection.
          </p>
        </div>

        <div className="flex flex-col gap-2 px-6 py-5 sm:flex-row">
          <button type="button" onClick={onOpenSettings} className="btn-primary flex-1">
            Open Local AI settings
          </button>
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
