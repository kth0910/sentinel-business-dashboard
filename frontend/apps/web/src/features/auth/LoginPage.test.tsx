import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // jsdom has no matchMedia; the UI store reads it when it loads
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  })) as any;
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LoginPage } from './LoginPage.tsx';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function reply(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

function called(fetch: ReturnType<typeof vi.fn>) {
  return fetch.mock.calls.map((c) => String((c as unknown[])[0]));
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function submit() {
  await act(async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<LoginPage />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('shows only email and password sign-in', () => {
    const text = host.textContent ?? '';
    expect(host.querySelectorAll('.nc-auth-provider')).toHaveLength(0);
    for (const word of ['Google', 'Apple', 'Microsoft', 'ChatGPT', 'SSO', '패스키', '가입']) expect(text).not.toContain(word);
    expect(host.querySelector('#email')).not.toBeNull();
  });

  it('asks for the password when the email has an account', async () => {
    const fetch = vi.fn(() => reply({ hasAccount: true, passwordSignIn: true, mustReverify: false }));
    vi.stubGlobal('fetch', fetch);
    act(() => typeInto(host.querySelector('#email')!, 'admin@example.com'));
    await submit();
    expect(called(fetch)).toContain('/api/rpc/checkSignInMethods');
    expect(host.querySelector('#password')).not.toBeNull();
    expect(host.querySelector('#code')).toBeNull();
  });

  it('says the email is not registered instead of sending a code', async () => {
    const fetch = vi.fn(() => reply({ hasAccount: false, passwordSignIn: false, mustReverify: false }));
    vi.stubGlobal('fetch', fetch);
    act(() => typeInto(host.querySelector('#email')!, 'ghost@example.com'));
    await submit();
    expect(called(fetch)).toContain('/api/rpc/checkSignInMethods');
    expect(called(fetch)).not.toContain('/api/rpc/sendSignInCode');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('등록되지 않은 이메일입니다. 주소를 확인하거나 관리자에게 문의해 주세요.');
    expect(host.querySelector('#password')).toBeNull();
  });
});
