export function isBabyModel(id) {
  return /_baby(?:_|$)/.test(id);
}

export function adultModelId(id) {
  return id.replace(/_baby(?=_|$)/, '');
}
