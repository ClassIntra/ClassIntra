function accountId(user) {
  const value = user && (user.user_id || user.id || user.username);
  return value === null || value === undefined || value === '' ? 'anonymous' : String(value);
}

export function getDailyAllowanceHiddenKey(date, user) {
  return 'ci:txy:hidden:' + String(date) + ':' + accountId(user);
}

function read(storage, key) {
  if (!storage) return null;
  if (typeof storage.getItem === 'function') return storage.getItem(key);
  return storage[key] === undefined ? null : storage[key];
}

export function isDailyAllowanceHidden(storage, date, user) {
  return read(storage, getDailyAllowanceHiddenKey(date, user)) === '1';
}
