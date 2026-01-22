import { useState } from 'react';
import {
  History as HistoryIcon,
  Trash2,
  Film,
  Tv,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Filter,
} from 'lucide-react';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Badge } from '@/components/common/Badge';
import { useDeletionHistory } from '@/hooks/useApi';
import { formatBytes, formatDate, formatRelativeTime } from '@/lib/utils';
import { ErrorState } from '@/components/common/ErrorState';
import { EmptyState } from '@/components/common/EmptyState';
import type { HistoryItem } from '@/types';

export default function History() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('30d');

  const { data, isLoading, isError, error, refetch } = useDeletionHistory({
    search,
    page,
    limit: 20,
    dateRange,
  });

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  // Calculate stats
  const totalDeleted = data?.stats?.totalDeleted || 0;
  const totalSpaceReclaimed = data?.stats?.totalSpaceReclaimed || 0;

  const handleExport = () => {
    // In a real app, this would trigger a CSV download
    alert('Export functionality would download a CSV of deletion history');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Deletion History</h1>
          <p className="text-surface-400 mt-1">
            Log of all deleted media items
          </p>
        </div>
        <Button variant="secondary" onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-ruby-500/10">
              <Trash2 className="w-6 h-6 text-ruby-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Total Items Deleted</p>
              <p className="text-2xl font-bold text-white">{totalDeleted}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-emerald-500/10">
              <HistoryIcon className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm text-surface-400">Space Reclaimed</p>
              <p className="text-2xl font-bold text-white">{formatBytes(totalSpaceReclaimed)}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <Input
              placeholder="Search deleted items..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              icon={<Search className="w-4 h-4" />}
            />
          </div>

          {/* Date Range Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-surface-400" />
            <select
              value={dateRange}
              onChange={(e) => {
                setDateRange(e.target.value as typeof dateRange);
                setPage(1);
              }}
              className="input py-2"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
          </div>
        </div>
      </Card>

      {/* History List */}
      {isLoading ? (
        <Card>
          <div className="divide-y divide-surface-800">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-surface-800/50" />
            ))}
          </div>
        </Card>
      ) : isError ? (
        <ErrorState
          error={error as Error}
          title="Failed to load history"
          retry={refetch}
        />
      ) : data && data.items.length > 0 ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Item
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Size
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Deleted
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-surface-400 uppercase tracking-wider bg-surface-800/50">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <HistoryRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : search || dateRange !== 'all' ? (
        <Card className="p-12">
          <EmptyState
            icon={Search}
            variant="filtered"
            title="No matching history"
            description="No deleted items match your search or date range. Try different search terms or adjust the date filter."
            action={{
              label: 'Clear Filters',
              onClick: () => {
                setSearch('');
                setDateRange('all');
              },
            }}
          />
        </Card>
      ) : (
        <Card className="p-12">
          <EmptyState
            icon={HistoryIcon}
            title="No deletion history"
            description="Items you delete will appear here for your records. Process your deletion queue to start tracking cleanup activity."
          />
        </Card>
      )}

      {/* Pagination */}
      {data && data.total > 20 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-400">
            Showing {(page - 1) * 20 + 1} to{' '}
            {Math.min(page * 20, data.total)} of {data.total} items
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm text-surface-300">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page === totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ item }: { item: HistoryItem }) {
  const TypeIcon = item.type === 'movie' ? Film : Tv;

  return (
    <tr className="border-b border-surface-800 hover:bg-surface-800/30 transition-colors">
      {/* Title */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-10 bg-surface-800 rounded flex items-center justify-center flex-shrink-0">
            <TypeIcon className="w-4 h-4 text-surface-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-white truncate max-w-xs">
              {item.title}
            </p>
            {item.year && (
              <p className="text-xs text-surface-400">{item.year}</p>
            )}
          </div>
        </div>
      </td>

      {/* Type */}
      <td className="px-4 py-3">
        <Badge variant={item.type}>{item.type}</Badge>
      </td>

      {/* Size */}
      <td className="px-4 py-3 text-sm text-surface-300">
        {formatBytes(item.size)}
      </td>

      {/* Deleted Date */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-surface-500" />
          <div>
            <p className="text-sm text-surface-300">{formatDate(item.deletedAt)}</p>
            <p className="text-xs text-surface-500">{formatRelativeTime(item.deletedAt)}</p>
          </div>
        </div>
      </td>

      {/* Reason */}
      <td className="px-4 py-3">
        {item.deletionReason === 'rule' ? (
          <span className="text-sm text-accent-400">
            Rule: {item.matchedRule || 'Unknown'}
          </span>
        ) : (
          <span className="text-sm text-surface-400">Manual</span>
        )}
      </td>
    </tr>
  );
}
