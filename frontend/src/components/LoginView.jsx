import { useRef, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { LegalFooterLinks } from './LegalNotice';
import AlphaChip from './AlphaChip';

function isSecureLoginContext() {
  if (window.isSecureContext) return true;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function publicAuthError(error) {
  const text = String(error?.message || 'Sign in failed.');
  if (/invalid login|invalid credentials|email not confirmed/i.test(text)) {
    return 'Invalid email or password.';
  }
  if (/already registered|already been registered/i.test(text)) {
    return 'An account with that email already exists. Sign in instead.';
  }
  if (/password/i.test(text) && /least|character|weak|short/i.test(text)) {
    return 'Choose a stronger password (at least 8 characters).';
  }
  return 'Could not complete sign in. Check your email and password.';
}

export default function LoginView() {
  const { refreshSession } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef(null);

  const clearPassword = () => {
    if (passwordRef.current) passwordRef.current.value = '';
    setShowPassword(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const client = getSupabaseClient();
    const password = passwordRef.current?.value || '';

    if (!isSecureLoginContext()) {
      clearPassword();
      setError('Sign in requires a secure (HTTPS) connection.');
      return;
    }

    if (!client) {
      clearPassword();
      setError('Supabase client is not configured.');
      return;
    }

    if (mode === 'signup' && password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setMessage('');

    try {
      if (mode === 'signin') {
        const { error: signInError } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        clearPassword();
        await refreshSession();
      } else {
        const { error: signUpError } = await client.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        clearPassword();
        setMessage('Account created. Check your email if confirmation is required, then sign in.');
        setMode('signin');
      }
    } catch (err) {
      clearPassword();
      setError(publicAuthError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(37,99,235,0.12),_transparent_35%),linear-gradient(180deg,#0b0f17_0%,#0f172a_100%)] p-4">
      <div className="panel w-full max-w-md p-8">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Project Intelligence Local
          </p>
          <AlphaChip />
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Sign in to continue</h1>
        <p className="mt-2 text-sm text-slate-400">
          Use the email and password for this workspace.
        </p>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setError('');
              setMessage('');
              clearPassword();
            }}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
              mode === 'signin'
                ? 'bg-accent-500 text-white'
                : 'bg-surface-800 text-slate-300'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setError('');
              setMessage('');
              clearPassword();
            }}
            className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium ${
              mode === 'signup'
                ? 'bg-accent-500 text-white'
                : 'bg-surface-800 text-slate-300'
            }`}
          >
            Sign Up
          </button>
        </div>

        <form
          method="post"
          autoComplete="on"
          onSubmit={handleSubmit}
          className="mt-6 space-y-4"
        >
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input-field"
              placeholder="you@company.com"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="login-password">
              Password
            </label>
            <div className="relative">
              <input
                id="login-password"
                name="password"
                ref={passwordRef}
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                minLength={mode === 'signup' ? 8 : 6}
                className="input-field pr-12"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-200"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243L9.88 9.88"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                    />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
              {error}
            </div>
          )}
          {message && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              {message}
            </div>
          )}

          <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
            {isSubmitting ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
          <LegalFooterLinks />
        </form>
      </div>
    </div>
  );
}
