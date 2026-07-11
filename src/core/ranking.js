export function assignSaveRank(newestFirst) {
  const n = newestFirst.length;
  return newestFirst.map((bookmark, index) => ({
    ...bookmark,
    saveRank: n - index,
  }));
}
