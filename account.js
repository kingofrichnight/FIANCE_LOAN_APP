(function (root) {
  'use strict';
  const STORE = 'lendwiseVaultV1', OLD = ['lendwisePortfolioV3', 'lendwiseBorrowers'];
  const $ = selector => document.querySelector(selector);
  let session = null, snapshot = null, handlers, busy = false, epoch = 0, idleTimer, lastActivity = Date.now();
  const IDLE_MS = 5 * 60 * 1000;
  const error = text => { $('#authError').textContent = text; $('#authError').hidden = !text; };
  function validatePayload(payload) {
    if (payload?.version !== 1 || typeof payload.profile?.name !== 'string' || !payload.profile.name.trim() || payload.profile.name.length > 80 || payload.portfolio?.version !== 3) throw new Error('This backup does not contain a valid local profile.');
    payload.portfolio.loans = handlers.validate(payload.portfolio.loans);
    return payload;
  }
  function setupScreen(message = '') {
    $('#appShell').hidden = true; $('#authScreen').hidden = false;
    const form = $('#authForm'); form.reset(); error(message);
    try {
      snapshot = localStorage.getItem(STORE);
      const existing = snapshot !== null;
      $('#authTitle').textContent = existing ? 'Unlock your local profile' : 'Create your local profile';
      $('#authSubmit').textContent = existing ? 'Unlock profile' : 'Create local profile';
      for (const id of ['profileNameField', 'confirmPasswordField', 'localConsentField']) {
        const field = $('#' + id); field.hidden = existing;
        field.querySelector('input').disabled = existing;
      }
      form.elements.password.minLength = existing ? 1 : 12;
      form.elements.password.autocomplete = existing ? 'current-password' : 'new-password';
      const legacy = OLD.some(key => localStorage.getItem(key) !== null);
      $('#migrationNotice').hidden = existing || !legacy;
      $('#authRecovery').hidden = !existing && !legacy;
      $('#authRecovery').textContent = existing ? 'Download encrypted recovery copy' : 'Download old data for recovery (not encrypted)';
      $('#authSubmit').disabled = !root.crypto?.subtle || !navigator.locks;
      if ($('#authSubmit').disabled) error('Use a modern browser over HTTPS (or localhost). Encryption and safe storage locks are required.');
    } catch { $('#authSubmit').disabled = true; error('Browser storage is disabled. Enable site storage to use a local profile.'); }
  }
  function lock(message = 'Signed out. Your saved portfolio is encrypted on this device.') {
    epoch++; session = null; clearTimeout(idleTimer);
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    handlers.lock(); setupScreen(message);
  }
  function activity() {
    if (!session) return;
    if (Date.now() - lastActivity >= IDLE_MS) { lock('Locked after five minutes without activity. Unlock to continue.'); return; }
    lastActivity = Date.now(); clearTimeout(idleTimer);
    idleTimer = setTimeout(() => lock('Locked after five minutes without activity. Unlock to continue.'), IDLE_MS);
  }
  function enter(opened, raw) {
    session = opened; snapshot = raw; epoch++; lastActivity = Date.now();
    $('#authForm').reset(); $('#authScreen').hidden = true; $('#appShell').hidden = false;
    $('#profileLabel').textContent = opened.payload.profile.name;
    handlers.unlock(opened.payload.portfolio.loans); activity();
  }
  async function exclusive(operation) {
    if (busy) throw new Error('A save or unlock is already in progress. Please wait.');
    if (!navigator.locks) throw new Error('This browser does not support safe local storage locks.');
    busy = true;
    try { return await navigator.locks.request('lendwise-vault-write', operation); }
    finally { busy = false; }
  }
  function write(expected, record, generation) {
    if (generation !== epoch) throw new Error('Your session locked. Unlock before saving changes.');
    if (localStorage.getItem(STORE) !== expected) throw new Error('This profile changed in another tab. Sign out and unlock again before saving.');
    const raw = JSON.stringify(record);
    try { localStorage.setItem(STORE, raw); }
    catch { throw new Error('Unable to save on this device. Storage may be full or disabled. Download an encrypted backup before reducing attached documents.'); }
    return raw;
  }
  async function save(loans) {
    const active = session, generation = epoch;
    if (!active) throw new Error('Unlock your local profile first.');
    return exclusive(async () => {
      const payload = { ...active.payload, portfolio: { version: 3, loans } };
      const record = await LoanVault.seal(payload, active.key, active.salt);
      snapshot = write(snapshot, record, generation);
      session = { ...active, payload, record };
    });
  }
  function hasRecovery() {
    return !!session && ['legacyRecovery', 'importedLegacyRecovery'].some(field => session.payload[field] && Object.values(session.payload[field]).some(value => value !== null));
  }
  async function purgeRecovery() {
    if (!session || !hasRecovery()) return;
    const active = session, generation = epoch, expected = snapshot;
    if (!await handlers.confirm('Remove old migration copies?', 'Keep your current borrowers and payments, but remove the old raw migration copies from this encrypted profile. Those copies may contain older deleted records. Download a backup first if you need that history. Existing downloaded backups are not changed.', 'Remove old copies')) return;
    await exclusive(async () => {
      if (epoch !== generation || localStorage.getItem(STORE) !== expected) throw new Error('The profile changed. Unlock it again before removing copies.');
      const { legacyRecovery, importedLegacyRecovery, ...payload } = active.payload;
      // Do not discard a recovery copy while its unencrypted original is still present.
      cleanupLegacy(legacyRecovery); cleanupLegacy(importedLegacyRecovery);
      if (OLD.some(key => localStorage.getItem(key) !== null)) throw new Error('Old unencrypted data is still present. Close older app tabs, sign out, and unlock before removing recovery copies.');
      const record = await LoanVault.seal(payload, active.key, active.salt);
      snapshot = write(expected, record, generation); session = { ...active, payload, record };
    });
    handlers.notice('Old migration copies removed. Current borrowers and payments are unchanged.');
  }
  async function deleteProfile() {
    if (!session) throw new Error('Unlock the profile before deleting it.');
    const generation = epoch, expected = snapshot;
    const values = await askPassword('Confirm your password to delete this profile');
    if (!values) return;
    await LoanVault.unlock(expected, values.password);
    if (!await handlers.confirm('Permanently delete this local profile?', 'Delete this profile, all borrowers, payments, documents, migration copies and Lendwise preferences from this browser only? This cannot be undone here. Download an encrypted backup first. Copies you downloaded or restored on other devices are not deleted.', 'Delete profile permanently')) return;
    await exclusive(async () => {
      if (epoch !== generation || localStorage.getItem(STORE) !== expected) throw new Error('The profile changed. Unlock it again before deleting.');
      // Exact app-owned keys only. Never clear unrelated sites sharing this origin.
      for (const key of [...OLD, 'lendwiseCurrency', 'lendwiseReminders', 'lendwiseMotion']) localStorage.removeItem(key);
      localStorage.removeItem(STORE);
      handlers.resetPreferences(); lock('Local profile deleted from this browser. Downloaded backups and other devices are unchanged.');
    });
  }
  // Old records are copied inside the encrypted payload before removing their plaintext keys.
  // They are only removed when unchanged since the migration snapshot.
  function cleanupLegacy(recovery) {
    for (const key of OLD) if (recovery?.[key] != null && localStorage.getItem(key) === recovery[key]) localStorage.removeItem(key);
  }
  async function submit(event) {
    event.preventDefault(); const form = event.currentTarget;
    if (!form.reportValidity()) return;
    $('#authSubmit').disabled = true; error('');
    const password = form.elements.password.value, generation = epoch;
    try {
      await exclusive(async () => {
        const expected = snapshot;
        if (localStorage.getItem(STORE) !== expected) throw new Error('Profile storage changed. Reload this page before continuing.');
        let opened, raw = expected;
        if (expected !== null) {
          opened = await LoanVault.unlock(expected, password); validatePayload(opened.payload);
        } else {
          if (password !== form.elements.confirmPassword.value) throw new Error('Passwords do not match.');
          const recovery = Object.fromEntries(OLD.map(key => [key, localStorage.getItem(key)]));
          let data = [];
          if (recovery[OLD[0]] !== null) {
            const old = JSON.parse(recovery[OLD[0]]);
            if (old.version !== 3) throw new Error('Unsupported old portfolio. Download a recovery copy before continuing.');
            data = old.loans;
          } else if (recovery[OLD[1]] !== null) data = JSON.parse(recovery[OLD[1]]);
          const payload = validatePayload({ version: 1, profile: { name: form.elements.profileName.value.trim() }, portfolio: { version: 3, loans: data }, legacyRecovery: recovery });
          opened = await LoanVault.create(payload, password);
          // Decrypt and validate the result before committing the migration.
          validatePayload((await LoanVault.unlock(opened.record, password)).payload);
          if (OLD.some(key => localStorage.getItem(key) !== recovery[key])) throw new Error('Old data changed in another tab. Close other app tabs and retry.');
          raw = write(expected, opened.record, generation);
        }
        if (generation !== epoch || localStorage.getItem(STORE) !== raw) throw new Error('Profile storage changed. Reload before continuing.');
        try { cleanupLegacy(opened.payload.legacyRecovery); } catch { /* Encrypted copy exists; preserve leftovers on cleanup failure. */ }
        enter(opened, raw);
      });
    } catch (reason) { error(reason.message); }
    finally { form.elements.password.value = ''; form.elements.confirmPassword.value = ''; $('#authSubmit').disabled = !root.crypto?.subtle || !navigator.locks; }
  }
  function askPassword(title, changing = false) {
    const dialog = $('#passwordModal'), form = $('#passwordForm');
    form.reset(); $('#passwordTitle').textContent = title;
    $('#newPasswordFields').hidden = !changing;
    form.elements.newPassword.disabled = form.elements.confirmPassword.disabled = !changing;
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => {
        const values = dialog.returnValue === 'confirm' ? { password: form.elements.password.value, next: form.elements.newPassword.value, confirm: form.elements.confirmPassword.value } : null;
        form.reset(); resolve(values);
      }, { once: true });
      dialog.showModal();
    });
  }
  async function changePassword() {
    if (!session) return;
    const active = session, generation = epoch, expected = snapshot;
    const values = await askPassword('Change local profile password', true);
    if (!values) return;
    if (values.next !== values.confirm) throw new Error('New passwords do not match.');
    await exclusive(async () => {
      await LoanVault.unlock(expected, values.password);
      const opened = await LoanVault.create(active.payload, values.next);
      snapshot = write(expected, opened.record, generation); session = opened;
    });
    handlers.notice('Password changed. Download a new encrypted backup. Older backups still use the old password.');
  }
  function backup() {
    const raw = localStorage.getItem(STORE);
    if (raw === null) throw new Error('No encrypted profile is saved yet.');
    return raw;
  }
  async function decodeBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Choose a valid Lendwise JSON backup.');
    if (data.format !== LoanVault.FORMAT) return data;
    const values = await askPassword('Enter this backup’s password');
    if (!values) return null;
    return validatePayload((await LoanVault.unlock(data, values.password)).payload).portfolio;
  }
  async function restoreAtLogin(input) {
    if (!input.files[0]) return;
    try {
      if (input.files[0].size > 20 * 1024 * 1024) throw new Error('Backup is too large (maximum 20 MB).');
      const data = LoanVault.parse(await input.files[0].text());
      const values = await askPassword('Enter this backup’s password');
      if (!values) return;
      const generation = epoch, expected = localStorage.getItem(STORE);
      const opened = await LoanVault.unlock(data, values.password); validatePayload(opened.payload);
      if (!await handlers.confirm('Restore local profile?', 'This replaces the encrypted profile on this browser. Download a recovery copy first if you need to keep it. The restored profile uses the backup’s password.', 'Restore profile')) return;
      await exclusive(async () => {
        // Retain any earlier plaintext records inside the new encrypted recovery section.
        const recovery = Object.fromEntries(OLD.map(key => [key, localStorage.getItem(key)]));
        if (OLD.some(key => recovery[key] !== null)) opened.payload.importedLegacyRecovery = recovery;
        opened.record = await LoanVault.seal(opened.payload, opened.key, opened.salt);
        const raw = write(expected, opened.record, generation);
        try { cleanupLegacy(recovery); } catch { /* Original records remain recoverable. */ }
        enter(opened, raw);
      });
    } catch (reason) { error(reason.message); }
    finally { input.value = ''; }
  }
  function start(callbacks) {
    handlers = callbacks; setupScreen();
    $('#authForm').addEventListener('submit', submit);
    $('#signOutBtn').onclick = () => lock();
    $('#authRestore').onchange = event => restoreAtLogin(event.currentTarget);
    $('#authRecovery').onclick = () => {
      try {
        const raw = localStorage.getItem(STORE);
        handlers.download(raw === null ? JSON.stringify({ recovery: true, ...Object.fromEntries(OLD.map(key => [key, localStorage.getItem(key)])) }) : raw, 'lendwise-recovery.json', 'application/json');
      } catch (reason) { error(reason.message); }
    };
    document.addEventListener('pointerdown', activity, true); document.addEventListener('keydown', activity, true);
    document.addEventListener('scroll', activity, { capture: true, passive: true });
    window.addEventListener('focus', () => { if (session && Date.now() - lastActivity >= IDLE_MS) lock('Session timed out. Unlock your profile again.'); });
    window.addEventListener('pagehide', () => lock('Unlock your local profile to continue.'));
    window.addEventListener('storage', event => { if ((event.key === STORE || event.key === null) && session) lock('Profile storage changed in another tab. Unlock again to load the saved version.'); });
  }
  root.LoanAccount = { start, save, lock, backup, decodeBackup, changePassword, deleteProfile, hasRecovery, purgeRecovery, isUnlocked: () => session !== null };
})(globalThis);
