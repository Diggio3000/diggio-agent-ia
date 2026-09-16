import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanRecordingUrl,
  validateProcedure,
  normalizeRecordingEvent,
  recordedInstructions
} from '../shared/learning.js';
import { keyChord } from '../shared/keyboard.js';
import { needsApproval } from '../shared/safety.js';
import { validateAction } from '../background/diggio-client.js';
test('La registrazione scarta valori e parametri URL; procedure validate', () => {
  assert.equal(
    cleanRecordingUrl('https://example.com/path?token=segreto#privato'),
    'https://example.com/path'
  );
  assert.throws(() => cleanRecordingUrl('javascript:alert(1)'));
  assert.throws(() => cleanRecordingUrl('https://user:pass@example.com'));
  const safe = normalizeRecordingEvent({
    kind: 'type',
    selector: '#field',
    label: 'Ricerca',
    value: 'SEGRETO',
    html: 'PRIVATO'
  });
  assert.deepEqual(Object.keys(safe), ['kind', 'selector', 'label']);
  assert.equal(normalizeRecordingEvent({ kind: 'execute_js' }), null);
  const steps = recordedInstructions({
    steps: [
      safe,
      { kind: 'manual' },
      { kind: 'select_option', label: 'Scelta', selector: '#choice' }
    ]
  });
  assert.match(steps, /\{\{dato_1\}\}/);
  assert.doesNotMatch(steps, /SEGRETO|PRIVATO/);
  const p = validateProcedure({
    name: 'Ricerca',
    instructions: 'Verifica il risultato',
    origin: 'https://example.com/file?token=secret'
  });
  assert.equal(p.origin, 'https://example.com');
  assert.ok(p.id);
  assert.throws(() => validateProcedure({ name: '', instructions: 'x' }));
  assert.throws(() => validateProcedure({ name: 'x', instructions: 'x'.repeat(12001) }));
});
test('Scorciatoie editor, nessun incolla implicito dagli appunti', () => {
  assert.equal(keyChord('Ctrl+Shift+ArrowRight').modifiers, 10);
  assert.equal(keyChord('Alt+/').code, 'Slash');
  assert.equal(keyChord('Ctrl+Alt+z').modifiers, 3);
  assert.equal(keyChord('F2').windowsVirtualKeyCode, 113);
  assert.equal(keyChord('Enter').text, '\r');
  assert.equal(keyChord('Ctrl+b').text, undefined);
  assert.throws(() => keyChord('Ctrl+v'));
  assert.throws(() => keyChord('Ctrl+w'));
  assert.throws(() => keyChord('nonsense+foo'));
});
test('Inserimento editor rispetta le approvazioni; attese validate', () => {
  assert.equal(needsApproval('insert_text', 'https://docs.google.com', 'ask_first'), true);
  assert.equal(needsApproval('insert_text', 'https://ads.google.com', 'auto'), true);
  assert.throws(() => validateAction('insert_text', { text: 'test' }));
  assert.throws(() => validateAction('wait_for', { selector: '#x', state: 'maybe' }));
  assert.throws(() => validateAction('wait_for', { selector: '#x', seconds: 31 }));
});
