export const X_ORIGIN = 'https://x.com';
export const OPERATIONS = Object.freeze({
  BOOKMARKS: 'Bookmarks',
  DELETE: 'DeleteBookmark',
  CREATE: 'CreateBookmark',
});

// Captured live values always win. No account token or cookie is committed here.
export const BOOKMARK_FEATURES = Object.freeze({
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
});
