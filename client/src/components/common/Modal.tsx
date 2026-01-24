import { Fragment, ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full';
}

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: ModalProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    full: 'max-w-[90vw]',
  };

  // Use portal to render modal at document body level
  return createPortal(
    <Fragment>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-surface-950/80 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={cn(
            'w-full bg-surface-900/95 backdrop-blur-xl border border-surface-700/50 rounded-2xl shadow-2xl shadow-black/50',
            'animate-scale-in',
            sizes[size]
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          {title && (
            <div className="flex items-start justify-between px-6 py-5 border-b border-surface-700/50">
              <div>
                <h2 className="text-lg font-display font-semibold text-white">{title}</h2>
                {description && (
                  <p className="text-sm text-surface-400 mt-1">{description}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-surface-400 hover:text-white hover:bg-surface-800/80 transition-all duration-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Content */}
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </Fragment>,
    document.body
  );
}

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  isLoading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'primary',
  isLoading = false,
}: ConfirmModalProps) {
  const buttonVariants = {
    danger: 'bg-ruby-500/20 hover:bg-ruby-500/30 border-ruby-500/30 hover:border-ruby-500/50 text-ruby-400 hover:text-ruby-300 focus:ring-ruby-500/30',
    warning: 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/30 hover:border-amber-500/50 text-amber-400 hover:text-amber-300 focus:ring-amber-500/30',
    primary: 'bg-gradient-to-r from-accent-500 to-accent-600 hover:from-accent-400 hover:to-accent-500 text-surface-950 border-transparent focus:ring-accent-500/50',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <div className="space-y-6">
        <p className="text-surface-300 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold rounded-xl',
              'bg-surface-700/80 hover:bg-surface-600/80 border border-surface-600/50 hover:border-surface-500/50',
              'text-surface-200 hover:text-white',
              'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-surface-500/30 focus:ring-offset-2 focus:ring-offset-surface-900'
            )}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              'px-5 py-2.5 text-sm font-semibold rounded-xl border',
              'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-900',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              buttonVariants[variant]
            )}
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing...
              </span>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
