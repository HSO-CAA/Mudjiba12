import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { toast, Toaster } from 'sonner';

import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles.css';

import { errorMessage } from './lib/api';
import { queryClient, setErrorReporter } from './lib/query';
import { uploads } from './lib/uploads';
import { ConfirmProvider } from './components/ui/confirm';
import { router } from './router';
import { useMediaQuery } from './hooks/useMediaQuery';

setErrorReporter((error) => toast.error(errorMessage(error)));

uploads.setNotifier({
  onDone: (item) =>
    toast.success('تم رفع الفيديو', {
      description: `«${item.title || item.fileName}» ${item.result?.status === 'READY' ? 'جاهز.' : 'وصل، وهسة يتجهز للعرض.'}`,
    }),
  onError: (item) => toast.error(`تعذّر رفع «${item.title || item.fileName}»`, { description: item.error ?? undefined }),
  onRejected: (message) => toast.error(message),
});

/** Bottom-left on desktop; top-center on phones so toasts never cover the bottom nav or upload queue. */
function Toasts() {
  const desktop = useMediaQuery('(min-width: 40rem)');
  return (
    <Toaster
      dir="rtl"
      theme="dark"
      position={desktop ? 'bottom-left' : 'top-center'}
      mobileOffset={{ top: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
      closeButton
      visibleToasts={4}
      toastOptions={{ duration: 4500 }}
    />
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
      <Toasts />
    </QueryClientProvider>
  </StrictMode>,
);
