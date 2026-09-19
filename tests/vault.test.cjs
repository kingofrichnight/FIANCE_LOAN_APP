const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../vault.js');
const payload = { version: 1, profile: { name: 'Private Name 李' }, portfolio: { version: 3, loans: [{ phone: '+91 9000000000', document: 'private-document' }] } };
const password = 'synthetic test password';

test('encrypted roundtrip hides profile, contacts, documents and password; key is non-extractable', async () => {
  const session = await V.create(payload, password), raw = JSON.stringify(session.record);
  assert.equal(session.key.extractable, false);
  for (const secret of ['Private Name', '+91', 'private-document', password]) assert.equal(raw.includes(secret), false);
  assert.deepEqual((await V.unlock(raw, password)).payload, payload);
  const next = await V.seal(payload, session.key, session.salt);
  assert.notEqual(next.iv, session.record.iv); assert.notEqual(next.data, session.record.data);
});

test('wrong password and ciphertext tampering fail closed, with no plaintext fallback', async () => {
  const { record } = await V.create(payload, password);
  await assert.rejects(V.unlock(record, 'wrong password'), /Incorrect password/);
  const tampered = { ...record, data: (record.data[0] === 'A' ? 'B' : 'A') + record.data.slice(1) };
  await assert.rejects(V.unlock(tampered, password), /Incorrect password/);
  await assert.rejects(V.unlock({ ...record, iterations: 1 }, password), /Unsupported/);
  await assert.rejects(V.unlock({ ...record, iv: 'AAAA' }, password), /Invalid/);
});

test('independent profiles and password changes use different salts and cannot cross-unlock', async () => {
  const first = await V.create(payload, password), second = await V.create(payload, 'a different passphrase');
  assert.notEqual(first.record.salt, second.record.salt);
  await assert.rejects(V.unlock(second.record, password));
  assert.deepEqual((await V.unlock(second.record, 'a different passphrase')).payload, payload);
  await assert.rejects(V.create(payload, 'short'), /12–256/);
});
