const memoryStore = new Map<string, string>();

export function readStoredValue(key: string) {
  if (typeof window === "undefined" || !window.localStorage) {
    return memoryStore.get(key) ?? null;
  }

  return window.localStorage.getItem(key);
}

export function writeStoredValue(key: string, value: string) {
  if (typeof window === "undefined" || !window.localStorage) {
    memoryStore.set(key, value);
    return;
  }

  window.localStorage.setItem(key, value);
}

export function readQuestionNumberFromUrl() {
  if (typeof window === "undefined") return null;

  const match = window.location.pathname.match(/\/questions\/(\d+)/);
  if (!match) return null;

  return Number(match[1]);
}

export function writeQuestionUrl(questionId: number) {
  if (typeof window === "undefined") return;

  const nextPath = `/questions/${questionId}`;
  if (window.location.pathname === nextPath) return;

  window.history.replaceState(null, "", nextPath);
}
