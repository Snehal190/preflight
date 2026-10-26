// The box closes only once every check has passed: then the four flaps fold down one after
// another and it's taped shut (product owner: keep the box open while the rules fall in).

export function isSealed(packed: number, total = 10): boolean {
  return packed >= total;
}
