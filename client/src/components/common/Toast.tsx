import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

interface ToastProviderProps {
  children: ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast = { ...toast, id };

    setToasts((prev) => [...prev, newToast]);

    // Auto remove after duration (default 5 seconds)
    const duration = toast.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  removeToast: (id: string) => void;
}

function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 w-80">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const icons = {
    success: CheckCircle,
    error: AlertCircle,
    info: Info,
    warning: AlertTriangle,
  };

  const styles = {
    success: {
      bg: 'bg-emerald-950 border-emerald-500/40',
      icon: 'text-emerald-400',
      bar: 'bg-emerald-500',
    },
    error: {
      bg: 'bg-ruby-950 border-ruby-500/40',
      icon: 'text-ruby-400',
      bar: 'bg-ruby-500',
    },
    info: {
      bg: 'bg-sky-950 border-sky-500/40',
      icon: 'text-sky-400',
      bar: 'bg-sky-500',
    },
    warning: {
      bg: 'bg-amber-950 border-amber-500/40',
      icon: 'text-amber-400',
      bar: 'bg-amber-500',
    },
  };

  const Icon = icons[toast.type];
  const s = styles[toast.type];

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border shadow-2xl shadow-black/50 animate-fade-up',
        s.bg,
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', s.icon)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{toast.title}</p>
          {toast.message && (
            <p className="text-xs text-surface-300 mt-0.5">{toast.message}</p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Dismiss notification"
          className="p-1 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4 text-surface-400" />
        </button>
      </div>
    </div>
  );
}

export default ToastProvider;
