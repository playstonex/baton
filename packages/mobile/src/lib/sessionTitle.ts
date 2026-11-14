/**
 * Session labelling shared by the chat header and the sidebar history list.
 *
 * Session ids are ULIDs. They are deliberately NOT part of the fallback chain:
 * `01KA9ZB3…` tells a reader nothing, so an un-titled session shows a generic
 * placeholder instead. Order of preference:
 *
 *   1. server-derived title — the daemon's session store builds it from the
 *      first user prompt
 *   2. the project folder name
 *   3. a generic placeholder
 */

export const UNTITLED_SESSION_LABEL = 'New chat';

export interface SessionTitleSource {
  title?: string | null;
  projectPath?: string | null;
}

/** Last non-empty path segment, tolerant of trailing slashes. */
export function projectFolderName(projectPath?: string | null): string {
  if (!projectPath) return '';
  const segments = projectPath.split('/').filter((segment) => segment.length > 0);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

export function resolveSessionTitle(source?: SessionTitleSource | null): string {
  // Titles come from prompts, which may be multi-line. Header and sidebar both
  // render single-line, so collapse whitespace rather than letting a newline
  // silently truncate the label.
  const title = source?.title?.replace(/\s+/g, ' ').trim();
  if (title) return title;

  const folder = projectFolderName(source?.projectPath);
  if (folder) return folder;

  return UNTITLED_SESSION_LABEL;
}
