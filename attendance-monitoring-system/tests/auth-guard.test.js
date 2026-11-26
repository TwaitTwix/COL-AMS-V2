import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAuthClient } from '../public/js/auth-guard.js';

test('returns the auth client when it exists', () => {
  const client = { auth: { signInWithPassword: async () => ({}) } };
  const result = requireAuthClient(client, () => {});

  assert.strictEqual(result, client);
});

test('blocks action until auth is initialized', () => {
  let lastMessage = '';
  const result = requireAuthClient(undefined, (message, state) => {
    lastMessage = `${message}|${state}`;
  });

  assert.strictEqual(result, null);
  assert.strictEqual(lastMessage, 'Please wait while sign-in loads…|error');
});
