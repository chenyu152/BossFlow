import { useCallback, useEffect, useRef, useState } from 'react';

export function useNotice() {
  const [notice, setNotice] = useState('');
  const timeoutRef = useRef<number | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setNotice('');
      timeoutRef.current = null;
    }, 4200);
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  return {
    notice,
    showNotice,
  };
}
