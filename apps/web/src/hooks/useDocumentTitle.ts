import { useEffect } from 'react';

/** Sets document.title (and the description meta when given) for client-side navigations. */
export function useDocumentTitle(title: string | null | undefined, description?: string | null): void {
  useEffect(() => {
    if (!title) return;
    document.title = title;
  }, [title]);

  useEffect(() => {
    if (!description) return;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [description]);
}
