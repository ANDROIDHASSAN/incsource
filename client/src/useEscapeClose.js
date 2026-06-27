import { useEffect } from 'react';

// Close a modal when the Escape key is pressed. Shared so every overlay behaves
// the same (they already close on the × button and backdrop click).
export function useEscapeClose(onClose) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}
