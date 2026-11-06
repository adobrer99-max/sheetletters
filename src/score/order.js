// The order measures are played in: repeats and 1st/2nd endings unrolled.
// A measure may carry repStart, repEnd (with repTimes) and endNums (which passes its ending belongs to).
export function playOrder(ms) {
  const order = [];
  let i = 0, start = 0, pass = 1, jumpedAt = -1;
  while (i < ms.length && order.length < 20000) {
    const m = ms[i];
    if (m.repStart && i !== start && i > jumpedAt) { start = i; pass = 1; }
    if (pass > 1 && i > jumpedAt && !m.endNums) { pass = 1; start = i; }
    if (m.endNums && !m.endNums.includes(pass)) { i++; continue; }
    order.push(i);
    const times = m.repTimes || (m.endNums ? Math.max(...m.endNums) + 1 : 2);
    if (m.repEnd && pass < times) {
      pass++; jumpedAt = Math.max(jumpedAt, i); i = start; continue;
    }
    if (m.repEnd && i >= jumpedAt) { pass = 1; start = i + 1; }
    i++;
  }
  return order;
}
