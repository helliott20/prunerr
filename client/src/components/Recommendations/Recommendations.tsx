import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingDown,
  Film,
  Tv,
  Trash2,
  Shield,
  Clock,
  HardDrive,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Filter,
  CheckCircle,
} from 'lucide-react';
import { useRecommendations, useMarkForDeletion, useProtectItem } from '@/hooks/useApi';
import { formatBytes, cn } from '@/lib/utils';
import { EmptyState } from '@/components/common/EmptyState';
import type { Recommendation } from '@/types';

export default function Recommendations() {
  const [page, setPage] = useState(1);
  const [unwatchedDays, setUnwatchedDays] = useState(90);
  const limit = 24;

  const { data, isLoading } = useRecommendations(limit * page, unwatchedDays);
  const markForDeletion = useMarkForDeletion();
  const protectItem = useProtectItem();

  // Get items for current page
  const startIndex = (page - 1) * limit;
  const currentItems = data?.items.slice(startIndex, startIndex + limit) || [];
  const totalPages = data ? Math.ceil(data.total / limit) : 1;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <header className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-ruby-500/5 rounded-3xl" />
        <div className="relative px-8 py-10">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-surface-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>

          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-violet-400 mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Smart Cleanup
              </p>
              <h1 className="text-4xl font-display font-bold text-white tracking-tight">
                Recommended for Cleanup
              </h1>
              <p className="text-surface-400 mt-2 max-w-lg">
                {data?.total || 0} items haven't been watched in {unwatchedDays}+ days
              </p>
            </div>

            {data && (
              <div className="hidden lg:block text-right">
                <p className="text-sm text-surface-400">Potential space savings</p>
                <p className="text-3xl font-display font-bold text-ruby-400">
                  {formatBytes(data.totalReclaimableSpace)}
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-surface-400" />
            <span className="text-sm text-surface-400">Unwatched for at least:</span>
          </div>
          <div className="flex gap-2">
            {[30, 60, 90, 180, 365].map((days) => (
              <button
                key={days}
                onClick={() => {
                  setUnwatchedDays(days);
                  setPage(1);
                }}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  unwatchedDays === days
                    ? 'bg-violet-500/20 text-violet-400'
                    : 'bg-surface-800/50 text-surface-400 hover:bg-surface-700/50 hover:text-surface-300'
                )}
              >
                {days < 365 ? `${days} days` : '1 year'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-violet-500/10">
              <HardDrive className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Total Items</p>
              <p className="text-2xl font-display font-bold text-white">{data.total}</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-ruby-500/10">
              <TrendingDown className="w-5 h-5 text-ruby-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Reclaimable Space</p>
              <p className="text-2xl font-display font-bold text-white">
                {formatBytes(data.totalReclaimableSpace)}
              </p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500/10">
              <Clock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Threshold</p>
              <p className="text-2xl font-display font-bold text-white">{unwatchedDays} days</p>
            </div>
          </div>
        </div>
      )}

      {/* Items Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="skeleton-shimmer h-48 rounded-xl" />
          ))}
        </div>
      ) : currentItems.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {currentItems.map((item, index) => (
            <RecommendationCard
              key={item.id}
              item={item}
              index={index}
              onMarkForDeletion={() => markForDeletion.mutate({ id: item.id })}
              onProtect={() => protectItem.mutate(item.id)}
              isDeleting={markForDeletion.isPending}
              isProtecting={protectItem.isPending}
            />
          ))}
        </div>
      ) : (
        <div className="card p-12">
          <EmptyState
            icon={CheckCircle}
            variant="success"
            title="No recommendations"
            description="Your library is well-maintained! Items that haven't been watched in a while will appear here as suggestions."
          />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-2 rounded-lg bg-surface-800/50 text-surface-400 hover:bg-surface-700/50 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="px-4 py-2 text-sm text-surface-300">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-2 rounded-lg bg-surface-800/50 text-surface-400 hover:bg-surface-700/50 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

interface RecommendationCardProps {
  item: Recommendation;
  index: number;
  onMarkForDeletion: () => void;
  onProtect: () => void;
  isDeleting: boolean;
  isProtecting: boolean;
}

function RecommendationCard({
  item,
  index,
  onMarkForDeletion,
  onProtect,
  isDeleting,
  isProtecting,
}: RecommendationCardProps) {
  const TypeIcon = item.type === 'movie' ? Film : Tv;
  const typeColor = item.type === 'movie' ? 'violet' : 'emerald';

  return (
    <div
      className="group card overflow-hidden animate-fade-up opacity-0"
      style={{
        animationDelay: `${index * 30}ms`,
        animationFillMode: 'forwards',
      }}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-surface-800">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={item.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <TypeIcon className="w-16 h-16 text-surface-700" />
          </div>
        )}

        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-900 via-surface-900/50 to-transparent" />

        {/* Type badge */}
        <div
          className={cn(
            'absolute top-3 left-3 p-1.5 rounded-lg',
            typeColor === 'violet' ? 'bg-violet-500/80' : 'bg-emerald-500/80'
          )}
        >
          <TypeIcon className="w-4 h-4 text-white" />
        </div>

        {/* Size badge */}
        <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-surface-900/80 backdrop-blur-sm">
          <span className="text-xs font-medium text-surface-200">{formatBytes(item.size)}</span>
        </div>

        {/* Content overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="text-sm font-display font-semibold text-white line-clamp-2 mb-2">
            {item.title}
          </h3>

          <div
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium',
              item.neverWatched ? 'bg-ruby-500/20 text-ruby-400' : 'bg-amber-500/20 text-amber-400'
            )}
          >
            <Clock className="w-3 h-3" />
            {item.reason}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="p-3 flex gap-2">
        <button
          onClick={onMarkForDeletion}
          disabled={isDeleting}
          className="flex-1 py-2 px-3 text-xs font-medium rounded-lg bg-ruby-500/10 text-ruby-400 hover:bg-ruby-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Queue
        </button>
        <button
          onClick={onProtect}
          disabled={isProtecting}
          className="flex-1 py-2 px-3 text-xs font-medium rounded-lg bg-accent-500/10 text-accent-400 hover:bg-accent-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <Shield className="w-3.5 h-3.5" />
          Protect
        </button>
      </div>
    </div>
  );
}
