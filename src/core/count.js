export function countLeft(bookmarks, cleared) {
  return Object.keys(bookmarks).filter((id) => cleared[id]?.action !== 'done').length;
}
