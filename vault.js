(function (root) {
  'use strict';
  const FORMAT = 'lendwise-encrypted-vault', ITERATIONS = 600000;
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  const aad = encoder.encode('Lendwise local vault v1; PBKDF2-SHA256; AES-256-GCM');
  function base64(bytes) {
    let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  }
  function bytes(value, max) {
    if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid encrypted backup.');
    return Uint8Array.from(atob(value), ch => ch.charCodeAt(0));
  }
  function parse(value) {
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    if (!record || record.format !== FORMAT || record.version !== 1 || record.kdf !== 'PBKDF2-SHA256' || record.iterations !== ITERATIONS || record.cipher !== 'AES-256-GCM') throw new Error('Unsupported encrypted backup format.');
    if (bytes(record.salt, 24).length !== 16 || bytes(record.iv, 16).length !== 12 || bytes(record.data, 20 * 1024 * 1024).length < 16) throw new Error('Invalid encrypted backup.');
    return record;
  }
  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Use a password or passphrase of 12–256 characters.');
  }
  async function derive(password, salt) {
    if (!root.crypto?.subtle) throw new Error('Encryption requires HTTPS or localhost and a modern browser.');
    const material = await root.crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return root.crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(payload, key, salt) {
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const data = await root.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, encoder.encode(JSON.stringify(payload)));
    return { format: FORMAT, version: 1, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(data)) };
  }
  async function create(payload, password) {
    validatePassword(password);
    const salt = root.crypto.getRandomValues(new Uint8Array(16)), key = await derive(password, salt);
    return { key, salt, payload, record: await seal(payload, key, salt) };
  }
  async function unlock(input, password) {
    const record = parse(input);
    if (typeof password !== 'string' || password.length > 256) throw new Error('Enter your profile password.');
    const salt = bytes(record.salt, 24), key = await derive(password, salt);
    try {
      const decoded = await root.crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(record.iv, 16), additionalData: aad, tagLength: 128 }, key, bytes(record.data, 20 * 1024 * 1024));
      return { key, salt, record, payload: JSON.parse(decoder.decode(decoded)) };
    } catch { throw new Error('Incorrect password, or the encrypted data is damaged. Nothing has been changed.'); }
  }
  const api = { FORMAT, parse, create, unlock, seal, validatePassword };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LoanVault = api;
})(globalThis);
