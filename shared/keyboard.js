export function keyChord(input) {
  const tokens = String(input)
    .trim()
    .split('+')
    .map((s) => s.trim().toLowerCase());
  const keyName = tokens.pop();
  const flags = {
    ctrl: 2,
    control: 2,
    alt: 1,
    option: 1,
    shift: 8,
    maiusc: 8,
    meta: 4,
    cmd: 4,
    command: 4
  };
  let modifiers = 0;
  for (const token of tokens) {
    if (!flags[token]) throw new Error('Modificatore tastiera non valido.');
    modifiers |= flags[token];
  }
  const specials = {
    enter: ['Enter', 'Enter', 13, '\r'],
    tab: ['Tab', 'Tab', 9],
    escape: ['Escape', 'Escape', 27],
    esc: ['Escape', 'Escape', 27],
    backspace: ['Backspace', 'Backspace', 8],
    delete: ['Delete', 'Delete', 46],
    space: [' ', 'Space', 32, ' '],
    arrowdown: ['ArrowDown', 'ArrowDown', 40],
    arrowup: ['ArrowUp', 'ArrowUp', 38],
    arrowleft: ['ArrowLeft', 'ArrowLeft', 37],
    arrowright: ['ArrowRight', 'ArrowRight', 39],
    pagedown: ['PageDown', 'PageDown', 34],
    pageup: ['PageUp', 'PageUp', 33],
    home: ['Home', 'Home', 36],
    end: ['End', 'End', 35],
    '/': ['/', 'Slash', 191],
    '.': ['.', 'Period', 190],
    ',': [',', 'Comma', 188]
  };
  let key = specials[keyName];
  if (!key && /^[a-z]$/.test(keyName))
    key = [
      modifiers & 8 ? keyName.toUpperCase() : keyName,
      'Key' + keyName.toUpperCase(),
      keyName.toUpperCase().charCodeAt(0)
    ];
  if (!key && /^\d$/.test(keyName)) key = [keyName, 'Digit' + keyName, keyName.charCodeAt(0)];
  if (!key && /^f([1-9]|1[0-2])$/.test(keyName))
    key = [keyName.toUpperCase(), keyName.toUpperCase(), 111 + Number(keyName.slice(1))];
  if (!key)
    throw new Error(
      'Tasto non supportato. Esempi: Enter, Ctrl+Home, Ctrl+Shift+ArrowRight, Alt+/.'
    );
  if (
    (modifiers & 6 && ['w', 'n', 't', 'l'].includes(keyName) && !(modifiers & 1)) ||
    (keyName === 'f4' && modifiers & 3)
  )
    throw new Error('Usa i comandi espliciti del browser per navigare o gestire schede.');
  if (modifiers & 6 && keyName === 'v')
    throw new Error(
      'Per inserire contenuti usa read_editor e insert_text; non incollare gli appunti del dispositivo.'
    );
  return {
    key: key[0],
    code: key[1],
    windowsVirtualKeyCode: key[2],
    nativeVirtualKeyCode: key[2],
    modifiers,
    text: modifiers & 7 ? undefined : key[3] || (/^[a-z0-9/.,]$/i.test(key[0]) ? key[0] : undefined)
  };
}
