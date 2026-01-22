import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { getUserFriendlyMessage } from '@/lib/utils';

export interface ErrorStateProps {
  error: Error | null;
  title?: string;
  retry?: () => void;
}

/**
 * Reusable error state component for displaying user-friendly error messages
 * with optional retry functionality.
 */
export function ErrorState({ error, title = 'Something went wrong', retry }: ErrorStateProps) {
  const message = error ? getUserFriendlyMessage(error) : 'An unexpected error occurred.';

  return (
    <div className="card p-12 text-center">
      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-ruby-500/10 flex items-center justify-center">
        <AlertCircle className="w-8 h-8 text-ruby-400" />
      </div>
      <h3 className="text-lg font-display font-semibold text-surface-200 mb-2">
        {title}
      </h3>
      <p className="text-surface-400 mb-4 max-w-md mx-auto">
        {message}
      </p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          <RefreshCw className="w-4 h-4" />
          Try Again
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
