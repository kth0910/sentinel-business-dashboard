// CoolNotion! sign-in: email -> password -> session. Accounts are issued by an admin (later: company mail),
// so there is no sign-up, social/passkey/SSO sign-in, login code, MFA, demo or password reset here.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { useSession } from '../../lib/store/session.ts';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';
import { AddAccountBar } from '../shell/accounts.tsx';
import './icons.tsx';
import './auth.css';

type Step = 'email' | 'password';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NOT_REGISTERED = '등록되지 않은 이메일입니다. 주소를 확인하거나 관리자에게 문의해 주세요.';

export function LoginPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = `CoolNotion! - ${t('lp.auth.log_in', 'Log in')}`;
  }, []);

  const reset = () => {
    setStep('email');
    setPassword('');
    setError(null);
    setTimeout(() => emailRef.current?.focus(), 0);
  };

  const submitEmail = async () => {
    setError(null);
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setError(t('lp.auth.that_email_address_isn_t_valid', 'That email address isn’t valid.'));
      return;
    }
    setBusy(true);
    try {
      const opts = await api('checkSignInMethods', { email: addr });
      if (opts.passwordSignIn) setStep('password');
      else setError(NOT_REGISTERED);
    } catch (e: any) {
      setError(e?.message || NOT_REGISTERED);
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setError(null);
    setBusy(true);
    try {
      await api('signInWithEmail', { email: email.trim(), password });
      await useSession.getState().load();
    } catch (e: any) {
      setError(e?.message || t('lp.auth.incorrect_password', 'Incorrect password.'));
    } finally {
      setBusy(false);
    }
  };

  const submitLabel = step === 'password' ? t('lp.auth.log_in', 'Log in') : t('lp.auth.continue', 'Continue');

  return (
    <div className="nc-auth">
      <main className="nc-auth-main">
        <div className="nc-auth-col">
          <div className="nc-auth-center">
            <div className="nc-auth-spacer-top" />
            <Icon name="litpage" size={40} className="nc-auth-logo" />
            <div className="nc-auth-heading">
              <h1>CoolNotion!</h1>
              <h2>{t('lp.auth.sign_in_to_keep_working_in', 'Sign in to keep working in CoolNotion!')}</h2>
            </div>
            <div className="lit-login nc-auth-login">
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy) return;
                  if (step === 'email') void submitEmail();
                  else void login();
                }}
              >
                <label className="nc-auth-label" htmlFor="email">{t('lp.auth.email', 'Email')}</label>
                <div className={`nc-auth-field ${step !== 'email' ? 'locked' : ''}`}>
                  <input
                    ref={emailRef}
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    readOnly={step !== 'email'}
                    placeholder={t('lp.auth.type_your_email', 'Type your email...')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {email && (
                    <div role="button" aria-label={t('lp.auth.clear_input', 'Clear Input')} className="nc-auth-clear" onClick={() => { setEmail(''); reset(); }}>
                      <Icon name="xMarkCircleFill" size={20} />
                    </div>
                  )}
                </div>
                {step === 'password' && (
                  <>
                    <label className="nc-auth-label second" htmlFor="password">{t('lp.auth.password', 'Password')}</label>
                    <div className="nc-auth-field">
                      <input
                        id="password"
                        type="password"
                        autoFocus
                        autoComplete="current-password"
                        placeholder={t('lp.auth.enter_your_password', 'Type your password...')}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <button className="nc-auth-submit" type="submit" disabled={busy}>
                  {busy ? <span className="nc-auth-spinner" /> : submitLabel}
                </button>
              </form>
              {error && <div role="alert" className="nc-auth-error">{error}</div>}
            </div>
            <div className="nc-auth-spacer-bottom" />
          </div>
        </div>
      </main>
      <AddAccountBar />
    </div>
  );
}
